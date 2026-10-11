/** Port of Benzene.Http.BenzeneMessage.BenzeneMessageHttpMiddleware. */
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { IMiddleware, IMiddlewarePipeline, NextFunc } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageApplication, JsonSerializer } from '@benzenejs/core-message-handlers';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  BenzeneMessageResponse,
  IBenzeneMessageResponse,
} from '@benzenejs/core-messages';
import { BenzeneResult, BenzeneResultStatus, ProblemTypes } from '@benzenejs/results';
import { IHttpContext } from '../IHttpContext';
import { IHttpRequestAdapter } from '../IHttpRequestAdapter';
import { IHttpStatusCodeMapper } from '../IHttpStatusCodeMapper';
import { BenzeneMessageHttpOptions } from './BenzeneMessageHttpOptions';

/**
 * Transport-agnostic HTTP middleware that dispatches a POSTed BenzeneMessage envelope
 * (`{ "topic": ..., "headers": ..., "body": ... }`) into a BenzeneMessage pipeline — the HTTP
 * equivalent of the direct AWS Lambda invoke path. Works on any Benzene HTTP transport (API Gateway,
 * Azure Functions, Express, self-host) because it drives the transport-neutral request/response
 * adapters directly, the same short-circuit shape as the OAuth2 bearer middleware.
 *
 * On a POST to its path it runs the envelope through the pipeline (topic routing, validation,
 * middleware, handler — the `"benzene"` transport) and writes the response envelope
 * (`{ "statusCode": ..., "isSuccessful": ..., "headers": ..., "body": ... }`) as `application/json`.
 * Any other request falls through to `next`. The envelope is always read and written with Benzene's
 * default JSON serialization, regardless of the payload formats the app's own serializer negotiates.
 *
 * **Status line** (transport-bindings §1, D17): **200 for every envelope the endpoint processed**,
 * whatever the result's status — the envelope carries the outcome, and a client reads it, never the
 * status line. A `deleted` result is 200 with its envelope (not 204); an `unauthorized`/`forbidden`
 * result from the pipeline's own auth middleware is a processed envelope, so 200 as well. Only a carrier
 * failure is non-2xx: a malformed envelope (not JSON, not an object, or no topic) is **400**, answered
 * with an `application/problem+json` document since no envelope was processed. A problem document inside
 * a processed envelope omits `status` (wire-contracts §1.3).
 *
 * Security (D21): this endpoint exposes every topic the pipeline routes — including topics with no HTTP
 * mapping. It runs the same pipeline (and so the same auth middleware) as the service's other transports;
 * restrict the reachable topics with {@link BenzeneMessageHttpOptions.topicFilter} (a restricted topic is
 * a processed `not-found`, exactly as if no handler matched) and do not expose it unauthenticated in
 * production.
 *
 * DIVERGENCE from the pre-spec-0.2.0 behaviour (and .NET at the time of porting): the status line used to
 * be mapped from the envelope's status via `IHttpStatusCodeMapper`; spec-0.2.0 (D17) made it 200 for
 * every processed envelope. The mapper parameter is kept for the 400 carrier-failure document.
 *
 * C# `ITerminalMiddleware` has no marker equivalent in the TypeScript pipeline; the short-circuit is
 * expressed by simply not calling `next` on a match (exactly as the ported HTTP short-circuit
 * middleware do).
 *
 * Divergence from C#: the inner BenzeneMessage pipeline is dispatched through a dedicated
 * `IServiceResolverFactory` supplied by {@link useBenzeneMessage} (over the endpoint's own DI
 * container), rather than the outer HTTP scope's factory. C# disambiguates the two pipelines' context
 * services (`IMessageGetter<TContext>` etc.) by the closed generic type; TypeScript erases the generic
 * to a single token, so the inner envelope pipeline gets its own container — the port's "one container
 * per entry point" rule, applied to nesting.
 */
export class BenzeneMessageHttpMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  private static readonly serializer = new JsonSerializer();

  readonly name = 'BenzeneMessageHttp';

  private readonly path: string;
  private readonly topicFilter?: (topic: string) => boolean;
  private readonly application: BenzeneMessageApplication;

  constructor(
    options: BenzeneMessageHttpOptions,
    pipeline: IMiddlewarePipeline<BenzeneMessageContext>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
    private readonly httpStatusCodeMapper: IHttpStatusCodeMapper,
  ) {
    this.path = normalizePath(options.path);
    this.topicFilter = options.topicFilter;
    this.application = new BenzeneMessageApplication(pipeline);
  }

  /**
   * Dispatches a matching POSTed envelope into the BenzeneMessage pipeline and short-circuits; any
   * other request is passed to the next middleware.
   */
  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const request = this.httpRequestAdapter.map(context);

    if ((request.method ?? '').toUpperCase() !== 'POST' || normalizePath(request.path) !== this.path) {
      await next();
      return;
    }

    const outcome = await this.dispatchAsync(context);

    if (outcome.kind === 'malformed') {
      // A carrier failure: no envelope was processed, so the HTTP response is itself the problem
      // document (wire-contracts §4.1), with its `status` member equal to the status line.
      const statusCode = this.httpStatusCodeMapper.map(BenzeneResultStatus.badRequest, false);
      const problem = ProblemTypes.from(BenzeneResult.badRequest(outcome.message));
      problem.status = Number(statusCode);
      this.responseAdapter.setStatusCode(context, statusCode);
      this.responseAdapter.setContentType(context, 'application/problem+json; charset=utf-8');
      this.responseAdapter.setBody(context, BenzeneMessageHttpMiddleware.serializer.serialize(problem));
      await this.responseAdapter.finalizeAsync(context);
      return;
    }

    // Every processed envelope is 200, whatever its status: the envelope carries the outcome (D17).
    this.responseAdapter.setStatusCode(context, ProcessedEnvelopeStatusCode);
    this.responseAdapter.setContentType(context, 'application/json; charset=utf-8');
    this.responseAdapter.setBody(context, BenzeneMessageHttpMiddleware.serializer.serialize(outcome.response));
    await this.responseAdapter.finalizeAsync(context);
  }

  private async dispatchAsync(
    context: TContext,
  ): Promise<{ kind: 'processed'; response: IBenzeneMessageResponse } | { kind: 'malformed'; message: string }> {
    let request: BenzeneMessageRequest | undefined;
    try {
      const body = this.messageBodyGetter.getBody(context);
      request =
        body === undefined || body.trim() === ''
          ? undefined
          : BenzeneMessageHttpMiddleware.serializer.deserialize<BenzeneMessageRequest>(body);
    } catch {
      return { kind: 'malformed', message: 'The request body is not a valid BenzeneMessage envelope' };
    }

    if (
      request === undefined ||
      request === null ||
      typeof request !== 'object' ||
      typeof request.topic !== 'string' ||
      request.topic.trim() === ''
    ) {
      return { kind: 'malformed', message: 'The request body must be a BenzeneMessage envelope with a topic' };
    }

    if (this.topicFilter !== undefined && !this.topicFilter(request.topic)) {
      return { kind: 'processed', response: notFoundEnvelope(request.topic) };
    }

    return { kind: 'processed', response: await this.application.handleAsync(request, this.serviceResolverFactory) };
  }
}

/** The status line of every envelope the endpoint processed (transport-bindings §1, D17). */
export const ProcessedEnvelopeStatusCode = '200';

/**
 * The answer for a topic outside the endpoint's restriction: a `not-found` envelope shaped exactly like
 * the router's own (D21) — the problem document as the body, without the HTTP-only `status` member.
 */
function notFoundEnvelope(topic: string): IBenzeneMessageResponse {
  const response = new BenzeneMessageResponse();
  response.statusCode = BenzeneResultStatus.notFound;
  response.isSuccessful = false;
  response.headers = { 'content-type': 'application/problem+json' };
  response.body = JSON.stringify(ProblemTypes.from(BenzeneResult.notFound(`No handler found for topic ${topic}`)));
  return response;
}

/**
 * Normalizes a path for case-insensitive, trailing-slash-insensitive matching (C# `NormalizePath`):
 * a blank path becomes `"/"`, a missing leading slash is added, a trailing slash (beyond the root) is
 * trimmed, and the result is lower-cased.
 */
function normalizePath(path: string | undefined): string {
  if (path === undefined || path.trim() === '') {
    return '/';
  }

  let trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    trimmed = `/${trimmed}`;
  }

  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.replace(/\/+$/, '');
  }

  return trimmed.toLowerCase();
}
