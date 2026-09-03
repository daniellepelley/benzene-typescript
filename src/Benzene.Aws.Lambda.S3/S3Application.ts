/** Port of Benzene.Aws.Lambda.S3.S3Application. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { S3Event } from 'aws-lambda';
import { S3MessageProcessingException } from './S3MessageProcessingException';
import { S3Options } from './S3Options';
import { S3RecordContext } from './S3RecordContext';

/**
 * Processes an S3 event notification batch by mapping each record to an `S3RecordContext` and running
 * them all through the middleware pipeline concurrently (each in its own DI scope), tagging the
 * transport as `"s3"` for the duration. Exception/failure-status behavior is configurable via
 * `S3Options`, mirroring `SnsApplication`.
 *
 * Faithful to .NET: C# `S3Application` runs each record through the shared
 * `SingleContextEscalatingApplicationBase` (the consolidated SNS/S3/EventBridge escalate/log logic);
 * this port keeps the per-adapter inline shape the TS SNS adapter already uses — the behavior
 * (per-record scope, concurrent fan-out, `catchExceptions`/`raiseOnFailureStatus` semantics, null
 * outcome escalated) is the same. `event.Records` stays PascalCase in `@types/aws-lambda`.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class S3Application implements IMiddlewareApplication<S3Event> {
  private readonly pipeline: IMiddlewarePipeline<S3RecordContext>;
  private readonly options: S3Options;

  constructor(pipeline: IMiddlewarePipeline<S3RecordContext>, options?: S3Options) {
    this.pipeline = new TransportMiddlewarePipeline<S3RecordContext>(TransportNames.S3, pipeline);
    this.options = options ?? new S3Options();
  }

  async handleAsync(event: S3Event, serviceResolverFactory: IServiceResolverFactory): Promise<void> {
    const tasks = event.Records.map((record) =>
      S3RecordContext.createInstance(event, record),
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

        // A null/unestablished outcome (messageResult never set — typically an unrouted record: no
        // handler matched the topic) is escalated the same as an explicit failure, not treated as
        // success. S3 has a redelivery backstop for the resulting retry (async-invoke retry + the
        // on-failure destination), so retaining an unrouted record here is safe — unlike Kafka/Event
        // Hub, which carve this out (work/settlement-consistency-fix-plan.md row 2 in benzene-dotnet).
        if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful !== true) {
          throw new S3MessageProcessingException(context.s3EventNotificationRecord.s3?.object?.key);
        }
      } catch (ex) {
        if (!this.options.catchExceptions) {
          throw ex;
        }

        const loggingScope = serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('S3Application') ??
            NullLogger.instance;
          logger.logError(
            ex,
            `Processing S3 object ${context.s3EventNotificationRecord.s3?.object?.key} failed`,
          );
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
