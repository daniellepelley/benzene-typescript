/** Port of Benzene.Azure.Function.QueueStorage.BenzeneMessageQueueStorageHandler. */
import { ISerializer, IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  IBenzeneMessageRequest,
} from '@benzenejs/core-messages';
import { BenzeneMessageResultApplication } from '@benzenejs/core-message-handlers';
import { MiddlewareRouter } from '@benzenejs/core-middleware';
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
 * RESULT SURFACING: as the C# handler does, this runs a `BenzeneMessageResultApplication` and assigns
 * the inner handler's `IBenzeneResult` onto the outer `QueueStorageContext.messageResult`, so the queue's
 * settlement sees a failure — or a missing result — that occurred inside the (response-suppressed)
 * envelope pipeline. (Before spec-0.2.0 the port re-derived a pass/fail flag from the response's status
 * text, which wire-contracts §1.2 forbids.)
 */
export class BenzeneMessageQueueStorageHandler extends MiddlewareRouter<
  IBenzeneMessageRequest,
  QueueStorageContext
> {
  private readonly directMessageApplication: BenzeneMessageResultApplication;
  private readonly serializer: ISerializer;

  /**
   * @param pipeline The direct-message middleware pipeline to dispatch matching messages to.
   * @param serviceResolver The service resolver for the current invocation scope.
   */
  constructor(pipeline: IMiddlewarePipeline<BenzeneMessageContext>, serviceResolver: IServiceResolver) {
    super(serviceResolver);
    this.serializer = serviceResolver.getService(ISerializer);
    this.directMessageApplication = new BenzeneMessageResultApplication(pipeline);
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
    // The inner handler's result itself — never re-derived from the status text (wire-contracts §1.2) —
    // so the queue settles on isSuccessful, sees a missing result as missing (redelivered), and can tell
    // the router's unmatched-topic result apart for ignoreUnmatchedTopics.
    const result = await this.directMessageApplication.handleAsync(request, serviceResolverFactory);
    if (result !== undefined) {
      context.messageResult = result;
    }
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
