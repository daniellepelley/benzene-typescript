/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusApplication. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { EntryPointMiddlewareApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { ServiceBusContext } from './ServiceBusContext';
import { ServiceBusMessageProcessingException } from './ServiceBusMessageProcessingException';
import { ServiceBusOptions } from './ServiceBusOptions';

/**
 * The entry point application for a Service Bus-triggered Azure Function. Maps each message in the
 * triggered batch to a `ServiceBusContext` and runs them all through the middleware pipeline, tagging
 * the transport as `"service-bus"` for the duration.
 *
 * Reuses the already-ported `EntryPointMiddlewareApplication<ServiceBusReceivedMessage[]>` (arity-1,
 * fire-and-forget), exactly as C#'s `ServiceBusApplication : EntryPointMiddlewareApplication<
 * ServiceBusReceivedMessage[]>`. `AzureFunctionApp` dispatches to it via the fire-and-forget
 * `handleAsync` path.
 */
export class ServiceBusApplication extends EntryPointMiddlewareApplication<ServiceBusReceivedMessage[]> {
  /**
   * @param pipeline The built Service Bus middleware pipeline to run each message through.
   * @param serviceResolverFactory The service resolver factory used to process each batch.
   * @param options Configures how a handler's exceptions and failure results are handled. Defaults to a
   *   new `ServiceBusOptions` (both flags off).
   */
  constructor(
    pipeline: IMiddlewarePipeline<ServiceBusContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: ServiceBusOptions,
  ) {
    super(new ServiceBusBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/**
 * Runs every message in a Service Bus trigger batch through the middleware pipeline concurrently, each
 * in its own service scope, applying `ServiceBusOptions` to decide whether a message's exception or
 * failure result is contained (logged, doesn't affect the rest of the batch) or left to cascade and
 * fail the whole invocation.
 *
 * Reuses the already-ported `IMiddlewareApplication<ServiceBusReceivedMessage[]>` (the fire-and-forget
 * arity-1 variant), matching C#'s `ServiceBusBatchApplication : IMiddlewareApplication<
 * ServiceBusReceivedMessage[]>`. Per-message SCOPE + TRANSPORT: it maps the message array to one
 * `ServiceBusContext` per message and runs each in ITS OWN scope (`createScope()` / try-finally
 * `dispose()`, the port of C# `using`), concurrently via `Promise.all` (C# `Task.WhenAll`). The
 * transport is set to `"service-bus"` inside each scope by wrapping the pipeline in the already-ported
 * `TransportMiddlewarePipeline` (which resolves `ISetCurrentTransport` and calls `setTransport` before
 * delegating) — this is exactly what the C# constructor does. NOTE: the C# literal transport name is
 * `"service-bus"` (matching `TransportInfo("service-bus")` registered by `addServiceBus`); it is kept
 * verbatim here for a faithful, internally-consistent port.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class ServiceBusBatchApplication implements IMiddlewareApplication<ServiceBusReceivedMessage[]> {
  private readonly pipeline: IMiddlewarePipeline<ServiceBusContext>;
  private readonly options: ServiceBusOptions;

  constructor(pipeline: IMiddlewarePipeline<ServiceBusContext>, options?: ServiceBusOptions) {
    this.pipeline = new TransportMiddlewarePipeline<ServiceBusContext>('service-bus', pipeline);
    this.options = options ?? new ServiceBusOptions();
  }

  async handleAsync(
    event: ServiceBusReceivedMessage[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const tasks = event
      .map((message) => new ServiceBusContext(message))
      .map(async (context) => {
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            await this.pipeline.handleAsync(context, scope);
          } finally {
            scope.dispose();
          }

          if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
            throw new ServiceBusMessageProcessingException(String(context.message.messageId));
          }
        } catch (ex) {
          if (!this.options.catchExceptions) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('ServiceBusApplication') ??
              NullLogger.instance;
            logger.logError(
              ex,
              `Processing Service Bus message ${String(context.message.messageId)} failed`,
            );
          } finally {
            loggingScope.dispose();
          }
        }
      });

    await Promise.all(tasks);
  }
}
