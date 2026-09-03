/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeApplication. */
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IMiddlewareApplication, IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { TransportMiddlewarePipeline, TransportNames } from '@benzenejs/core-message-handlers';
import { EventBridgeEvent } from 'aws-lambda';
import { EventBridgeContext } from './EventBridgeContext';
import { EventBridgeMessageProcessingException } from './EventBridgeMessageProcessingException';
import { EventBridgeOptions } from './EventBridgeOptions';

/**
 * Runs one EventBridge event through the `EventBridgeContext` middleware pipeline — a SINGLE-context
 * application (one pipeline invocation + one DI scope per event), since EventBridge invokes a Lambda
 * target with exactly one event, not a batch. Exception/failure-status behavior is configurable via
 * `EventBridgeOptions`, mirroring `SnsApplication`.
 *
 * Faithful to .NET: C# `EventBridgeApplication` runs its single context through the shared
 * `SingleContextEscalatingApplicationBase` (the consolidated SNS/S3/EventBridge escalate/log logic);
 * this port keeps the per-adapter inline shape the TS SNS adapter already uses — the behavior (own DI
 * scope, `catchExceptions`/`raiseOnFailureStatus` semantics, null outcome escalated) is the same.
 *
 * EXCEPTION SEMANTICS: C#'s `catch (Exception ex) when (_options.CatchExceptions)` is a conditional
 * catch — the exception is only caught when `catchExceptions` is true, otherwise it cascades.
 * TypeScript has no exception filters, so the port catches then re-throws when `catchExceptions` is
 * false, which is behaviorally identical.
 */
export class EventBridgeApplication implements IMiddlewareApplication<EventBridgeEvent<string, unknown>> {
  private readonly pipeline: IMiddlewarePipeline<EventBridgeContext>;
  private readonly options: EventBridgeOptions;

  constructor(pipeline: IMiddlewarePipeline<EventBridgeContext>, options?: EventBridgeOptions) {
    this.pipeline = new TransportMiddlewarePipeline<EventBridgeContext>(
      TransportNames.EventBridge,
      pipeline,
    );
    this.options = options ?? new EventBridgeOptions();
  }

  async handleAsync(
    event: EventBridgeEvent<string, unknown>,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const context = new EventBridgeContext(event);

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

      // A null/unestablished outcome (messageResult never set — typically an unrouted event: no
      // handler matched the topic) is escalated the same as an explicit failure, not treated as
      // success. EventBridge has a redelivery backstop for the resulting retry (rule target retry +
      // DLQ), so retaining an unrouted event here is safe — unlike Kafka/Event Hub, which carve this
      // out (work/settlement-consistency-fix-plan.md row 3 in benzene-dotnet).
      if (this.options.raiseOnFailureStatus && context.messageResult?.isSuccessful !== true) {
        throw new EventBridgeMessageProcessingException(context.event.id);
      }
    } catch (ex) {
      if (!this.options.catchExceptions) {
        throw ex;
      }

      const loggingScope = serviceResolverFactory.createScope();
      try {
        const logger =
          loggingScope.tryGetService(ILoggerFactory)?.createLogger('EventBridgeApplication') ??
          NullLogger.instance;
        logger.logError(ex, `Processing EventBridge event ${context.event.id} failed`);
      } finally {
        if (loggingScope.disposeAsync) {
          await loggingScope.disposeAsync();
        } else {
          loggingScope.dispose();
        }
      }
    }
  }
}
