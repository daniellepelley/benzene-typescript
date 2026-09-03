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
import { BenzeneResultStatus } from '@benzenejs/results';
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
 * (`{ "statusCode": ..., "headers": ..., "body": ... }`) as `application/json`, with the HTTP status
 * mapped from the envelope's status via {@link IHttpStatusCodeMapper}. Any other request falls through
 * to `next`. The envelope is always read and written with Benzene's default JSON serialization,
 * regardless of the payload formats the app's own serializer negotiates.
 *
 * Security: this endpoint exposes every topic the pipeline routes — including topics with no HTTP
 * mapping — so it is opt-in and intended for local development or protected/admin environments.
 * Restrict topics with {@link BenzeneMessageHttpOptions.topicFilter} and compose authentication
 * middleware in front of it; do not expose it unauthenticated in production.
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
   *
   * CANCELLATION (the .NET R17 #285 fix, ported): the HTTP context's abort signal — the request's
   * client-gone signal, when the transport context exposes one as a structural `signal` member
   * (see `IHttpContext`'s doc comment; e.g. `ExpressContext.signal`) — is (a) threaded
   * onto the dispatched envelope request as a structural `signal` member, so inner-pipeline handlers
   * and their outbound sends can observe it via `context.benzeneMessageRequest.signal`, and (b) raced
   * against the dispatch: once the caller is gone the in-flight dispatch is abandoned and this
   * middleware rejects with the signal's abort reason instead of writing a response nobody will read.
   * (JS cancellation is cooperative — the abandoned dispatch keeps running until its handler next
   * observes the signal; its eventual settlement is swallowed.)
   */
  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const request = this.httpRequestAdapter.map(context);

    if ((request.method ?? '').toUpperCase() !== 'POST' || normalizePath(request.path) !== this.path) {
      await next();
      return;
    }

    const response = await raceWithAbort(this.dispatchAsync(context), signalOf(context));

    this.responseAdapter.setStatusCode(
      context,
      this.httpStatusCodeMapper.map(response.statusCode, response.isSuccessful),
    );
    this.responseAdapter.setContentType(context, 'application/json; charset=utf-8');
    this.responseAdapter.setBody(context, BenzeneMessageHttpMiddleware.serializer.serialize(response));
    await this.responseAdapter.finalizeAsync(context);
  }

  private async dispatchAsync(context: TContext): Promise<IBenzeneMessageResponse> {
    let request: BenzeneMessageRequest | undefined;
    try {
      const body = this.messageBodyGetter.getBody(context);
      request =
        body === undefined || body.trim() === ''
          ? undefined
          : BenzeneMessageHttpMiddleware.serializer.deserialize<BenzeneMessageRequest>(body);
    } catch {
      return errorResponse(
        BenzeneResultStatus.badRequest,
        'The request body is not a valid BenzeneMessage envelope',
      );
    }

    if (request?.topic === undefined || request.topic.trim() === '') {
      return errorResponse(
        BenzeneResultStatus.badRequest,
        'The request body must be a BenzeneMessage envelope with a topic',
      );
    }

    if (this.topicFilter !== undefined && !this.topicFilter(request.topic)) {
      return errorResponse(
        BenzeneResultStatus.notFound,
        `Topic '${request.topic}' is not available on this endpoint`,
      );
    }

    // Thread the HTTP request's abort signal onto the dispatched envelope request (structurally — the
    // wire shape has no signal member), so inner-pipeline handlers and outbound sends can observe it.
    (request as BenzeneMessageRequest & { signal?: AbortSignal }).signal = signalOf(context);

    return this.application.handleAsync(request, this.serviceResolverFactory);
  }
}

/** Reads an `AbortSignal` structurally off an HTTP context that carries one as a `signal` member. */
function signalOf(context: unknown): AbortSignal | undefined {
  const candidate = (context as { signal?: unknown } | null | undefined)?.signal;
  return candidate instanceof AbortSignal ? candidate : undefined;
}

/**
 * Awaits `work`, but once `signal` aborts, rejects with the signal's abort reason instead — the
 * abandoned `work` promise's eventual settlement is swallowed (JS cannot forcibly stop it). An
 * already-aborted signal rejects without awaiting at all.
 */
async function raceWithAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return work;
  }
  if (signal.aborted) {
    work.catch(() => {});
    throw abortReason(signal);
  }

  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      work.catch(() => {});
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort !== undefined) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** The signal's abort reason, or a generic error for an environment that supplies none. */
function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The inbound HTTP request was aborted.');
}

function errorResponse(statusCode: string, message: string): IBenzeneMessageResponse {
  const response = new BenzeneMessageResponse();
  response.statusCode = statusCode;
  response.isSuccessful = false;
  response.headers = {};
  response.body = JSON.stringify({ message });
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
