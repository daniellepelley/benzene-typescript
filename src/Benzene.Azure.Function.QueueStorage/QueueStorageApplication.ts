/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { BoundedFanOut, EntryPointMiddlewareApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzene/core-message-handlers';
import { QueueStorageContext } from './QueueStorageContext';
import { QueueStorageMessage } from './QueueStorageMessage';
import { QueueStorageMessageProcessingException } from './QueueStorageMessageProcessingException';
import { QueueStorageOptions } from './QueueStorageOptions';

/**
 * The entry point application for a Queue Storage-triggered Azure Function. Maps each message to a
 * `QueueStorageContext` and runs it through the middleware pipeline, tagging the transport as
 * `"queue-storage"` for the duration. Exception/failure-status behavior is configurable via
 * `QueueStorageOptions`, mirroring the C# `QueueStorageApplication` (and `KafkaApplication`).
 *
 * Reuses the already-ported `EntryPointMiddlewareApplication<QueueStorageMessage[]>` (arity-1,
 * fire-and-forget), exactly as C#'s `QueueStorageApplication : EntryPointMiddlewareApplication<
 * QueueStorageMessage[]>`. `AzureFunctionApp` dispatches to it via the fire-and-forget `handleAsync`
 * path.
 */
export class QueueStorageApplication extends EntryPointMiddlewareApplication<QueueStorageMessage[]> {
  /**
   * @param pipeline The built Queue Storage middleware pipeline to run each message through.
   * @param serviceResolverFactory The service resolver factory used to process each invocation.
   * @param options Configures how a handler's exceptions and failure results are handled, and the
   *   batch fan-out concurrency. Defaults to a new `QueueStorageOptions` (`catchExceptions` off,
   *   `raiseOnFailureStatus` on) if omitted.
   */
  constructor(
    pipeline: IMiddlewarePipeline<QueueStorageContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: QueueStorageOptions,
  ) {
    super(new QueueStorageBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/**
 * Runs every message in a Queue Storage delivery through the middleware pipeline concurrently, each in
 * its own service scope, applying `QueueStorageOptions` to decide whether a message's exception or
 * failure result is contained (logged) or left to cascade and fail the invocation (so the host's
 * poison handling engages).
 *
 * Reuses the already-ported `IMiddlewareApplication<QueueStorageMessage[]>` (the fire-and-forget
 * arity-1 variant), matching C#'s `QueueStorageBatchApplication : IMiddlewareApplication<
 * QueueStorageMessage[]>`. Per-message SCOPE + TRANSPORT: it maps the message array to one
 * `QueueStorageContext` per message and runs each in ITS OWN scope (`createScope()` / try-finally
 * `dispose()`, the port of C# `using`), fanned out via the already-ported `BoundedFanOut.whenAllAsync`
 * (C# `BoundedFanOut.WhenAllAsync`) so `maxDegreeOfParallelism` optionally caps concurrency — with no
 * ceiling it behaves exactly like `Promise.all` / C# `Task.WhenAll`. The transport is set to
 * `"queue-storage"` inside each scope by wrapping the pipeline in the already-ported
 * `TransportMiddlewarePipeline`, exactly what the C# constructor does.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class QueueStorageBatchApplication implements IMiddlewareApplication<QueueStorageMessage[]> {
  private readonly pipeline: IMiddlewarePipeline<QueueStorageContext>;
  private readonly options: QueueStorageOptions;

  constructor(pipeline: IMiddlewarePipeline<QueueStorageContext>, options?: QueueStorageOptions) {
    this.pipeline = new TransportMiddlewarePipeline<QueueStorageContext>(
      TransportNames.QueueStorage,
      pipeline,
    );
    this.options = options ?? new QueueStorageOptions();
  }

  async handleAsync(
    event: QueueStorageMessage[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const contexts = event.map((message) => new QueueStorageContext(message));
    await BoundedFanOut.whenAllAsync(
      contexts,
      async (context) => {
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            await this.pipeline.handleAsync(context, scope);
          } finally {
            scope.dispose();
          }

          if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
            throw new QueueStorageMessageProcessingException(context.message.messageId ?? 'unknown');
          }
        } catch (ex) {
          if (!this.options.catchExceptions) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('QueueStorageApplication') ??
              NullLogger.instance;
            logger.logError(
              ex,
              `Processing Queue Storage message ${context.message.messageId ?? '<none>'} failed`,
            );
          } finally {
            loggingScope.dispose();
          }
        }
      },
      this.options.maxDegreeOfParallelism,
    );
  }
}
