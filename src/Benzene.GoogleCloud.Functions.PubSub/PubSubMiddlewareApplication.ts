/** Port of Benzene.GoogleCloud.Functions.PubSub.PubSubMiddlewareApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzene/core-message-handlers';
import { MessagePublishedData } from './MessagePublishedData';
import { PubSubContext } from './PubSubContext';
import { PubSubMessageProcessingException } from './PubSubMessageProcessingException';
import { PubSubOptions } from './PubSubOptions';

/**
 * Runs a single Pub/Sub message through the middleware pipeline, applying `PubSubOptions` to decide
 * whether the message's exception or failure result is contained (logged, doesn't fail the invocation)
 * or left to cascade and fail it. Unlike AWS/Azure's batch-oriented trigger applications, there is NO
 * fan-out here — Cloud Functions delivers exactly one Pub/Sub message per invocation, so this is a
 * single-message application (no `Promise.all` loop), structurally like a single request.
 *
 * Reuses the already-ported `IMiddlewareApplication<MessagePublishedData>` (the fire-and-forget arity-1
 * variant), matching C#'s `PubSubMiddlewareApplication : IMiddlewareApplication<MessagePublishedData>`.
 * The transport is set to `"pubsub"` (`TransportNames.PubSub`) by wrapping the pipeline in the
 * already-ported `TransportMiddlewarePipeline`, exactly as the C# constructor does.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades. TypeScript
 * has no exception filters, so the port catches then re-throws when `catchExceptions` is false, which is
 * behaviorally identical.
 */
export class PubSubMiddlewareApplication implements IMiddlewareApplication<MessagePublishedData> {
  private readonly pipeline: IMiddlewarePipeline<PubSubContext>;
  private readonly options: PubSubOptions;

  /**
   * @param pipeline The built Pub/Sub middleware pipeline to run the message through.
   * @param options Configures how a handler's exceptions and failure results are handled. Defaults to a
   *   new `PubSubOptions` (`catchExceptions` off, `raiseOnFailureStatus` on) if omitted.
   */
  constructor(pipeline: IMiddlewarePipeline<PubSubContext>, options?: PubSubOptions) {
    this.pipeline = new TransportMiddlewarePipeline<PubSubContext>(TransportNames.PubSub, pipeline);
    this.options = options ?? new PubSubOptions();
  }

  async handleAsync(
    event: MessagePublishedData,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const context = new PubSubContext(event);

    try {
      const scope = serviceResolverFactory.createScope();
      try {
        await this.pipeline.handleAsync(context, scope);
      } finally {
        await scope.disposeAsync();
      }

      if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
        throw new PubSubMessageProcessingException(messageIdOf(context));
      }
    } catch (ex) {
      if (!this.options.catchExceptions) {
        throw ex;
      }

      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('PubSubMiddlewareApplication') ??
          NullLogger.instance;
        logger.logError(ex, `Processing Pub/Sub message ${messageIdOf(context)} failed`);
      } finally {
        await loggingScope.disposeAsync();
      }
    }
  }
}

/** The Pub/Sub message ID, tolerating either the camelCase or legacy snake_case CloudEvent encoding. */
function messageIdOf(context: PubSubContext): string {
  return context.message.messageId ?? context.message.message_id ?? '';
}
