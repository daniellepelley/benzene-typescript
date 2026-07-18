/** Port of Benzene.Aws.Lambda.Sns.SnsApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzene/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { SNSEvent } from 'aws-lambda';
import { SnsMessageProcessingException } from './SnsMessageProcessingException';
import { SnsOptions } from './SnsOptions';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Processes an SNS batch event by mapping each record to an `SnsRecordContext` and running them all
 * through the middleware pipeline concurrently, tagging the transport as `"sns"` for the duration.
 *
 * C# `IMiddlewareApplication<SNSEvent>` (the arity-1, fire-and-forget variant — SNS notifications do not
 * return a response) maps to the ported `IMiddlewareApplication<SNSEvent>`. Faithful to .NET:
 *   - wraps the pipeline in the already-ported `TransportMiddlewarePipeline("sns", pipeline)`, which
 *     resolves `ISetCurrentTransport` and calls `setTransport("sns")` before delegating — exactly what
 *     the C# constructor does;
 *   - iterates `event.Records` (this property stays PascalCase in `@types/aws-lambda`), building one
 *     `SnsRecordContext` per record;
 *   - runs each record's pipeline in ITS OWN service scope (`createScope()` / try-finally `dispose()`,
 *     the port of C# `using`), concurrently via `Promise.all` (the port of `Task.WhenAll`);
 *   - honors `SnsOptions`: `raiseOnFailureStatus` throws `SnsMessageProcessingException` when a handler
 *     reported an unsuccessful result; `catchExceptions` swallows-and-logs instead of cascading.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional catch
 * — the exception is only caught when `catchExceptions` is true, otherwise it cascades. TypeScript has no
 * exception filters, so the port catches then re-throws when `catchExceptions` is false, which is
 * behaviorally identical. `ILogger<SnsApplication>` maps to an `ILoggerFactory`-created logger, falling
 * back to `NullLogger`.
 */
export class SnsApplication implements IMiddlewareApplication<SNSEvent> {
  private readonly pipeline: IMiddlewarePipeline<SnsRecordContext>;
  private readonly options: SnsOptions;

  constructor(pipeline: IMiddlewarePipeline<SnsRecordContext>, options?: SnsOptions) {
    this.pipeline = new TransportMiddlewarePipeline<SnsRecordContext>('sns', pipeline);
    this.options = options ?? new SnsOptions();
  }

  async handleAsync(event: SNSEvent, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const tasks = event.Records.map((record) =>
      SnsRecordContext.createInstance(event, record),
    ).map(async (context) => {
      try {
        const scope = serviceResolverFactory.createScope();
        try {
          await this.pipeline.handleAsync(context, scope);
        } finally {
          scope.dispose();
        }

        if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful === false) {
          throw new SnsMessageProcessingException(context.snsRecord.Sns.MessageId);
        }
      } catch (ex) {
        if (!this.options.catchExceptions) {
          throw ex;
        }

        const loggingScope = serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('SnsApplication') ??
            NullLogger.instance;
          logger.logError(ex, `Processing SNS message ${context.snsRecord.Sns.MessageId} failed`);
        } finally {
          loggingScope.dispose();
        }
      }
    });

    await Promise.all(tasks);
  }
}
