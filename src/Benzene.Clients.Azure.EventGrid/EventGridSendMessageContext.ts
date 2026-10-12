/** Port of Benzene.Clients.Azure.EventGrid.EventGridSendMessageContext. */
import { SendCloudEventInput, SendEventGridEventInput } from '@azure/eventgrid';

/**
 * The middleware pipeline context for sending a single event to Azure Event Grid, in either the
 * CloudEvents 1.0 schema or the classic Event Grid schema. Exactly one of {@link cloudEvent} /
 * {@link eventGridEvent} is set, matching which factory was used.
 *
 * MESSAGE-TYPE ADAPTATION: .NET's `Azure.Messaging.CloudEvent` / `Azure.Messaging.EventGrid.EventGridEvent`
 * map to `@azure/eventgrid`'s `SendCloudEventInput` / `SendEventGridEventInput` (the input shapes the JS
 * publisher `send` accepts).
 */
export class EventGridSendMessageContext {
  /** Whether the event was sent. Set by `EventGridClientMiddleware` once the send completes without throwing. */
  isSent = false;

  /**
   * Set instead of a completed send when the SDK call rejected before the broker accepted the message; the
   * outbound converter turns it into a failed result (`failedSendResult`, transport-bindings.md §1) rather
   * than letting the exception escape the send. A port addition.
   */
  transportFailure?: unknown;

  private constructor(
    /** The CloudEvent to send, or `undefined` if this context carries a classic {@link eventGridEvent}. */
    readonly cloudEvent: SendCloudEventInput<unknown> | undefined,
    /** The classic Event Grid schema event to send, or `undefined` if this context carries a {@link cloudEvent}. */
    readonly eventGridEvent: SendEventGridEventInput<unknown> | undefined,
  ) {}

  /** Creates a context carrying a CloudEvents 1.0 event — the schema Benzene's Event Grid ingress prefers. */
  static forCloudEvent(cloudEvent: SendCloudEventInput<unknown>): EventGridSendMessageContext {
    return new EventGridSendMessageContext(cloudEvent, undefined);
  }

  /** Creates a context carrying a classic Event Grid schema event. */
  static forEventGridEvent(eventGridEvent: SendEventGridEventInput<unknown>): EventGridSendMessageContext {
    return new EventGridSendMessageContext(undefined, eventGridEvent);
  }
}
