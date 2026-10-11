/** Port of Benzene.Aws.Lambda.Sns.SnsApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { isSettledAsFailure, TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
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
 *   - honors `SnsOptions`: `raiseOnFailureStatus` (default on) throws `SnsMessageProcessingException` when
 *     a handler reported an unsuccessful result or none at all (an unmatched topic too, unless
 *     `ignoreUnmatchedTopics`); `catchExceptions` swallows-and-logs instead of cascading; `atMostOnce`
 *     acknowledges whatever the outcome.
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
    this.pipeline = new TransportMiddlewarePipeline<SnsRecordContext>(TransportNames.Sns, pipeline);
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
          if (scope.disposeAsync) {
            await scope.disposeAsync();
          } else {
            scope.dispose();
          }
        }

        // A failure result or no result at all is not acknowledged (transport-bindings §1, obligation 8):
        // failing the invocation is how a one-shot SNS delivery gets retried.
        if (
          !this.options.atMostOnce &&
          this.options.raiseOnFailureStatus &&
          isSettledAsFailure(context.messageResult, { ignoreUnmatchedTopics: this.options.ignoreUnmatchedTopics })
        ) {
          throw new SnsMessageProcessingException(context.snsRecord.Sns.MessageId);
        }
      } catch (ex) {
        if (!this.options.catchExceptions && !this.options.atMostOnce) {
          throw ex;
        }

        const loggingScope = serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('SnsApplication') ??
            NullLogger.instance;
          logger.logError(ex, `Processing SNS message ${context.snsRecord.Sns.MessageId} failed`);
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }
      }
    });

    await Promise.all(tasks);
  }
}
