/** Port of Benzene.Azure.Function.QueueStorage.BenzeneMessageQueueStorageHandler. */
import { ISerializer, IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  IBenzeneMessageRequest,
} from '@benzene/core-messages';
import { BenzeneMessageApplication, MessageResult } from '@benzene/core-message-handlers';
import { MiddlewareRouter } from '@benzene/core-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import { QueueStorageContext } from './QueueStorageContext';

/**
 * Routes a Queue Storage message whose text deserializes into a `BenzeneMessageRequest` (with a
 * non-null topic) to the direct-message middleware pipeline; otherwise it defers to the next
 * middleware. Added to the Queue Storage pipeline by `useBenzeneMessage`. Mirrors
 * `BenzeneMessageEventHubHandler` — like Event Hub events (and unlike Service Bus messages), Queue
 * Storage messages have no transport properties for a topic to ride on, so the envelope in the body
 * is where routing comes from.
 *
 * FAITHFUL to the C# `BenzeneMessageQueueStorageHandler : MiddlewareRouter<BenzeneMessageRequest,
 * QueueStorageContext>` — the already-ported `MiddlewareRouter` base drives `tryExtractRequest` ->
 * `canHandle` -> `handleFunction`.
 *
 * RESULT SURFACING (why this differs from the Event Hub handler): the C# handler runs a
 * `BenzeneMessageResultApplication` and assigns its `IBenzeneResult` onto the outer
 * `QueueStorageContext.MessageResult`, so a `raiseOnFailureStatus` escalation sees a failure that
 * occurred inside the (response-suppressed) envelope pipeline. `BenzeneMessageResultApplication` is not
 * ported (the TS transport-envelope `BenzeneMessageContext` dropped `IHasMessageResult`), so the port
 * reuses the already-ported `BenzeneMessageApplication` and maps the returned response's `statusCode`
 * — itself a `BenzeneResultStatus` written by the inner result setter — back to a pass/fail
 * `MessageResult` via `BenzeneResultStatus.isSuccess`, which is the exact signal the C# escalation
 * reads.
 */
export class BenzeneMessageQueueStorageHandler extends MiddlewareRouter<
  IBenzeneMessageRequest,
  QueueStorageContext
> {
  private readonly directMessageApplication: BenzeneMessageApplication;
  private readonly serializer: ISerializer;

  /**
   * @param pipeline The direct-message middleware pipeline to dispatch matching messages to.
   * @param serviceResolver The service resolver for the current invocation scope.
   */
  constructor(pipeline: IMiddlewarePipeline<BenzeneMessageContext>, serviceResolver: IServiceResolver) {
    super(serviceResolver);
    this.serializer = serviceResolver.getService(ISerializer);
    this.directMessageApplication = new BenzeneMessageApplication(pipeline);
  }

  /** Determines whether the deserialized request looks like a direct Benzene message (has a topic). */
  protected canHandle(request: IBenzeneMessageRequest): boolean {
    return request.topic !== undefined && request.topic !== null;
  }

  /**
   * Handles the message by running it through the direct-message application and surfacing the inner
   * handler's success/failure onto the outer `QueueStorageContext.messageResult`, so a
   * `raiseOnFailureStatus` escalation sees a failure that occurred inside the (response-suppressed)
   * envelope pipeline.
   */
  protected async handleFunction(
    request: IBenzeneMessageRequest,
    context: QueueStorageContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.directMessageApplication.handleAsync(request, serviceResolverFactory);
    context.messageResult = new MessageResult(BenzeneResultStatus.isSuccess(response.statusCode));
  }

  /** Attempts to deserialize the Queue Storage message text into a `BenzeneMessageRequest`; `undefined` on failure. */
  protected tryExtractRequest(context: QueueStorageContext): IBenzeneMessageRequest | undefined {
    try {
      return this.serializer.deserialize<BenzeneMessageRequest>(context.message.messageText);
    } catch {
      return undefined;
    }
  }
}
