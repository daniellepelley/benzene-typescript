import { ILoggerFactory, IServiceResolver, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import {
  BenzeneMessageApplication,
  BenzeneMessageResultApplication,
  isSettledAsFailure,
} from '@benzenejs/core-message-handlers';
import { AwsEventStreamContext } from '../AwsEventStream/AwsEventStreamContext';
import { AwsLambdaMiddlewareRouter } from '../AwsLambdaMiddlewareRouter';
import { isBenzeneMessageEvent } from '../AwsEventPredicates';
import { BenzeneMessageLambdaOptions } from './BenzeneMessageLambdaOptions';

/**
 * Port of Benzene.Aws.Lambda.Core.BenzeneMessage.BenzeneMessageLambdaHandler.
 *
 * Routes AWS Lambda invocations whose payload is a `BenzeneMessageRequest` (a transport-neutral
 * `{ topic, headers, body }` envelope) to the shared BenzeneMessage pipeline — the **direct-invoke**
 * surface. This is the Lambda-to-Lambda path the mesh aggregator uses to interrogate a service: a
 * synchronous `Invoke` carrying the reserved `benzene:spec`/`benzene:healthcheck` topic reaches the service's message
 * handlers with no HTTP surface required.
 *
 * Added to the outer `AwsEventStreamContext` pipeline by `useBenzeneMessage`. It handles the invocation
 * only if the payload has a non-empty `topic` (via the shared `isBenzeneMessageEvent` predicate);
 * otherwise it defers to the next middleware, so an API Gateway / SQS / … adapter can claim the same raw
 * payload instead.
 *
 * With `BenzeneMessageLambdaOptions.invocationType = 'Event'` the envelope is settled as a one-shot
 * delivery instead of answered: an outcome that must be redelivered fails the invocation
 * (`BenzeneMessageInvocationFailedException`), so Lambda's asynchronous retry applies.
 *
 * (The C# original swaps in a source-generated JSON serializer for a cold-start win; that's a .NET AOT
 * concern with no Node equivalent — the event arrives already parsed — so it is not ported.)
 */
export class BenzeneMessageLambdaHandler extends AwsLambdaMiddlewareRouter<BenzeneMessageRequest> {
  private readonly directMessageApplication: BenzeneMessageApplication;
  private readonly resultApplication: BenzeneMessageResultApplication;
  private readonly options: BenzeneMessageLambdaOptions;

  constructor(
    pipeline: IMiddlewarePipeline<BenzeneMessageContext>,
    serviceResolver: IServiceResolver,
    options?: BenzeneMessageLambdaOptions,
  ) {
    super(serviceResolver);
    this.directMessageApplication = new BenzeneMessageApplication(pipeline);
    this.resultApplication = new BenzeneMessageResultApplication(pipeline);
    this.options = options ?? new BenzeneMessageLambdaOptions();
  }

  protected canHandle(request: BenzeneMessageRequest): boolean {
    return isBenzeneMessageEvent(request);
  }

  protected async handleFunction(
    request: BenzeneMessageRequest,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    if (this.options.invocationType !== 'Event') {
      const response = await this.directMessageApplication.handleAsync(request, serviceResolverFactory);
      this.mapResponse(context, response);
      return;
    }

    // Asynchronous (one-shot) envelope: nobody reads a response, so the outcome settles the delivery.
    try {
      const result = await this.resultApplication.handleAsync(request, serviceResolverFactory);
      if (
        !this.options.atMostOnce &&
        isSettledAsFailure(result, { ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics })
      ) {
        throw new BenzeneMessageInvocationFailedException(request.topic, result?.status);
      }
    } catch (ex) {
      if (!this.options.atMostOnce) {
        throw ex;
      }
      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('BenzeneMessageLambdaHandler') ?? NullLogger.instance;
        logger.logError(ex, `Processing the asynchronous envelope for topic ${request.topic} failed`);
      } finally {
        loggingScope.dispose();
      }
    }
    this.mapResponse(context, null);
  }
}

/**
 * Thrown in `'Event'` mode when the envelope's invocation ended with a failure result or none, failing the
 * Lambda invocation so the platform retries it (transport-bindings §1, the asynchronous envelope).
 */
export class BenzeneMessageInvocationFailedException extends Error {
  readonly topic: string | undefined;

  constructor(topic: string | undefined, status: string | undefined) {
    super(
      `The asynchronous envelope for topic '${topic ?? '<none>'}' was not processed successfully ` +
        `(${status === undefined ? 'no result' : `status '${status}'`}); failing the invocation so Lambda retries it. ` +
        'Set ignoreUnmatchedTopics or atMostOnce on useBenzeneMessage to acknowledge instead.',
    );
    this.name = 'BenzeneMessageInvocationFailedException';
    this.topic = topic;
  }
}
