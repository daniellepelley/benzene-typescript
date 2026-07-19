/** Port of Benzene.Azure.Function.Kafka.KafkaApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { EntryPointMiddlewareApplication } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { KafkaContext } from './KafkaContext';
import { KafkaMessageProcessingException } from './KafkaMessageProcessingException';
import { KafkaOptions } from './KafkaOptions';
import { KafkaRecord } from './KafkaRecord';

/**
 * The entry point application for a Kafka-triggered Azure Function. Maps each event in the triggered
 * batch to a `KafkaContext` and runs them all through the middleware pipeline, tagging the transport as
 * `"kafka"` for the duration.
 *
 * Reuses the already-ported `EntryPointMiddlewareApplication<KafkaRecord[]>` (arity-1, fire-and-forget),
 * exactly as C#'s `KafkaApplication : EntryPointMiddlewareApplication<KafkaRecord[]>`. `AzureFunctionApp`
 * dispatches to it via the fire-and-forget `handleAsync` path.
 */
export class KafkaApplication extends EntryPointMiddlewareApplication<KafkaRecord[]> {
  /**
   * @param pipeline The built Kafka middleware pipeline to run each event through.
   * @param serviceResolverFactory The service resolver factory used to process each batch.
   * @param options Configures how a handler's exceptions and failure results are handled. Defaults to a
   *   new `KafkaOptions` (both flags off).
   */
  constructor(
    pipeline: IMiddlewarePipeline<KafkaContext>,
    serviceResolverFactory: IServiceResolverFactory,
    options?: KafkaOptions,
  ) {
    super(new KafkaBatchApplication(pipeline, options), serviceResolverFactory);
  }
}

/**
 * Runs every record in a Kafka trigger batch through the middleware pipeline concurrently, each in its
 * own service scope, applying `KafkaOptions` to decide whether a record's exception or failure result
 * is contained (logged, doesn't affect the rest of the batch) or left to cascade and fail the whole
 * invocation.
 *
 * Reuses the already-ported `IMiddlewareApplication<KafkaRecord[]>` (the fire-and-forget arity-1
 * variant), matching C#'s `KafkaBatchApplication : IMiddlewareApplication<KafkaRecord[]>`. Per-record
 * SCOPE + TRANSPORT: it maps the record array to one `KafkaContext` per record and runs each in ITS OWN
 * scope (`createScope()` / try-finally `dispose()`, the port of C# `using`), concurrently via
 * `Promise.all` (C# `Task.WhenAll`). The transport is set to `"kafka"` inside each scope by wrapping the
 * pipeline in the already-ported `TransportMiddlewarePipeline` (which resolves `ISetCurrentTransport` and
 * calls `setTransport` before delegating) — exactly what the C# constructor does.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades. TypeScript
 * has no exception filters, so the port catches then re-throws when `catchExceptions` is false, which is
 * behaviorally identical.
 */
export class KafkaBatchApplication implements IMiddlewareApplication<KafkaRecord[]> {
  private readonly pipeline: IMiddlewarePipeline<KafkaContext>;
  private readonly options: KafkaOptions;

  constructor(pipeline: IMiddlewarePipeline<KafkaContext>, options?: KafkaOptions) {
    this.pipeline = new TransportMiddlewarePipeline<KafkaContext>('kafka', pipeline);
    this.options = options ?? new KafkaOptions();
  }

  async handleAsync(
    event: KafkaRecord[],
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const tasks = event
      .map((kafkaEvent) => new KafkaContext(kafkaEvent))
      .map(async (context) => {
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            await this.pipeline.handleAsync(context, scope);
          } finally {
            scope.dispose();
          }

          if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
            throw new KafkaMessageProcessingException(context.kafkaEvent.topic);
          }
        } catch (ex) {
          if (!this.options.catchExceptions) {
            throw ex;
          }

          const loggingScope = serviceResolverFactory.createScope();
          try {
            const logger =
              loggingScope.tryGetService(ILoggerFactory)?.createLogger('KafkaApplication') ??
              NullLogger.instance;
            logger.logError(
              ex,
              `Processing Kafka record on topic ${context.kafkaEvent.topic} failed`,
            );
          } finally {
            loggingScope.dispose();
          }
        }
      });

    await Promise.all(tasks);
  }
}
