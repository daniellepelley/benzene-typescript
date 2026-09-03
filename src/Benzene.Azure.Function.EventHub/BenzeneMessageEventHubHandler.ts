/** Port of Benzene.Azure.Function.EventHub.Function.BenzeneMessageEventHubHandler. */
import { ISerializer, IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  IBenzeneMessageRequest,
} from '@benzenejs/core-messages';
import { BenzeneMessageApplication, MessageResult } from '@benzenejs/core-message-handlers';
import { MiddlewareRouter } from '@benzenejs/core-middleware';
import { BenzeneResultStatus } from '@benzenejs/results';
import { EventHubContext } from './EventHubContext';

/**
 * Routes an Event Hub event whose body deserializes into a `BenzeneMessageRequest` (with a non-null
 * topic) to the direct-message middleware pipeline; otherwise it defers to the next middleware. Added to
 * the Event Hub pipeline by `useBenzeneMessage`.
 *
 * FAITHFUL to the C# `BenzeneMessageEventHubHandler : MiddlewareRouter<BenzeneMessageRequest,
 * EventHubContext>` — the already-ported `MiddlewareRouter` base drives `tryExtractRequest` -> `canHandle`
 * -> `handleFunction`. This is why the Event Hub `EventHubContext` needs no per-message getters/result
 * setter (unlike Service Bus/Kafka): the request is recovered by deserializing the raw event body, and
 * routing/mapping happens inside the inner `BenzeneMessageApplication`'s own pipeline.
 *
 * BODY note: C# `_serializer.Deserialize<BenzeneMessageRequest>(context.EventData.EventBody.ToString())`
 * reads the `BinaryData` body as its string form. `@azure/event-hubs` exposes `ReceivedEventData.body` as
 * `any` (already decoded per the event's content type), so the port materializes a string first — an
 * existing `string` verbatim, binary UTF-8 decoded (the analogue of `BinaryData.ToString()`), and an
 * object `JSON.stringify`-ed (so an SDK-parsed JSON body still deserializes) — then deserializes that.
 */
export class BenzeneMessageEventHubHandler extends MiddlewareRouter<
  IBenzeneMessageRequest,
  EventHubContext
> {
  private readonly directMessageApplication: BenzeneMessageApplication;
  private readonly serializer: ISerializer;

  /**
   * @param pipeline The direct-message middleware pipeline to dispatch matching events to.
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
   * Handles the event by running it through the direct-message application and surfacing the inner
   * handler's success/failure onto the outer `EventHubContext.messageResult`, so an
   * `EventHubOptions.raiseOnFailureStatus` escalation sees a failure that occurred inside the
   * (response-suppressed) envelope pipeline — matching the C# handler's assignment onto
   * `EventHubContext.MessageResult` (same result-surfacing shape as
   * `BenzeneMessageQueueStorageHandler`).
   */
  protected async handleFunction(
    request: IBenzeneMessageRequest,
    context: EventHubContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.directMessageApplication.handleAsync(request, serviceResolverFactory);
    context.messageResult = new MessageResult(BenzeneResultStatus.isSuccess(response.statusCode));
  }

  /** Attempts to deserialize the Event Hub event body into a `BenzeneMessageRequest`; `undefined` on failure. */
  protected tryExtractRequest(context: EventHubContext): IBenzeneMessageRequest | undefined {
    try {
      const body = BenzeneMessageEventHubHandler.toBodyString(context.eventData.body);
      if (body === undefined) {
        return undefined;
      }
      return this.serializer.deserialize<BenzeneMessageRequest>(body);
    } catch {
      return undefined;
    }
  }

  private static toBodyString(body: unknown): string | undefined {
    if (body === undefined || body === null) {
      return undefined;
    }
    if (typeof body === 'string') {
      return body;
    }
    if (body instanceof Uint8Array) {
      return Buffer.from(body).toString('utf8');
    }
    return JSON.stringify(body);
  }
}
