/** Port of Benzene.Azure.Function.EventHub.Function.EventHubContext. */
import { ReceivedEventData } from '@azure/event-hubs';

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
 * FAITHFUL to the C#: a PRIVATE constructor plus a static `createInstance` factory (used as the
 * `MiddlewareMultiApplication` mapper by `EventHubApplication`). This context deliberately does NOT
 * implement `IHasMessageResult` — unlike Service Bus/Kafka, the C# `EventHubContext` carries no message
 * result; the Event Hub package routes via `BenzeneMessageEventHubHandler` (a `MiddlewareRouter`) instead
 * of per-message getters/result-setter.
 */
export class EventHubContext {
  private constructor(eventData: ReceivedEventData) {
    this.eventData = eventData;
  }

  /** The Event Hub event data. */
  readonly eventData: ReceivedEventData;

  /**
   * Creates a new `EventHubContext` for a single event. Port of C# `static EventHubContext
   * CreateInstance(EventData eventData)`.
   */
  static createInstance(eventData: ReceivedEventData): EventHubContext {
    return new EventHubContext(eventData);
  }
}
