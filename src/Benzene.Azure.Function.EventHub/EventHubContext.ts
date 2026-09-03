/** Port of Benzene.Azure.Function.EventHub.Function.EventHubContext. */
import { ReceivedEventData } from '@azure/event-hubs';
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';

/**
 * Provides the middleware pipeline context for a single event within an Event Hub trigger batch.
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `Azure.Messaging.EventHubs.EventData`. The Node ecosystem-native
 * equivalent for a *received* event is `ReceivedEventData` from `@azure/event-hubs` (the read side of
 * the SDK; `EventData` there is the send side), so the port depends on it directly rather than modelling
 * a bespoke shape. Field mapping used downstream: C# `EventData.EventBody` (`BinaryData`) ->
 * `receivedEventData.body` (`any`; the SDK exposes the decoded body — see
 * `BenzeneMessageEventHubHandler`). Renamed to `eventData` (camelCase) to match C# `EventData`.
 *
 * FAITHFUL to the C#: a PRIVATE constructor plus a static `createInstance` factory, and — matching the
 * C# `EventHubContext : IHasMessageResult` — a `messageResult` the escalation guard
 * (`EventHubOptions.raiseOnFailureStatus`) reads. On the default envelope routing path
 * (`useBenzeneMessage`) `BenzeneMessageEventHubHandler` surfaces the inner handler's result here.
 */
export class EventHubContext implements IHasMessageResult {
  private constructor(eventData: ReceivedEventData) {
    this.eventData = eventData;
  }

  /** The Event Hub event data. */
  readonly eventData: ReceivedEventData;

  /**
   * The result of handling this event. The Event Hubs trigger has no per-event settlement (the host
   * checkpoints the whole batch when the invocation returns successfully and re-delivers the whole
   * batch when it throws), so this is recorded for middleware/diagnostics and for
   * `EventHubOptions.raiseOnFailureStatus` only. Unset (C# `null`) until a result has been recorded.
   */
  messageResult!: IMessageResult;

  /**
   * Creates a new `EventHubContext` for a single event. Port of C# `static EventHubContext
   * CreateInstance(EventData eventData)`.
   */
  static createInstance(eventData: ReceivedEventData): EventHubContext {
    return new EventHubContext(eventData);
  }
}
