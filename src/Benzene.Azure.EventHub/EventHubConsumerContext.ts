/** Port of Benzene.Azure.EventHub.EventHubConsumerContext. */
import { ReceivedEventData } from '@azure/event-hubs';
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';

/**
 * Provides the middleware pipeline context for a single event received by the self-hosted consumer
 * ({@link BenzeneEventHubWorker}).
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `Azure.Messaging.EventHubs.EventData`; the Node ecosystem-native
 * equivalent for a *received* event is `ReceivedEventData` from `@azure/event-hubs` (the read side of
 * the SDK), so the port depends on it directly — same as `@benzenejs/azure-function-event-hub`. Field
 * mapping used by the getters: `EventData.EventBody`→`eventData.body`, `EventData.Properties`→
 * `eventData.properties`, `EventData.SequenceNumber`→`eventData.sequenceNumber`.
 *
 * Unlike the Functions `EventHubContext` (which routes via a `MiddlewareRouter` and carries no result),
 * this standalone consumer context implements `IHasMessageResult` — the worker reads the recorded result
 * to escalate a non-exception failure into a not-checkpointed outcome (see
 * `BenzeneEventHubConfig.raiseOnFailureStatus`).
 */
export class EventHubConsumerContext implements IHasMessageResult {
  private constructor(readonly eventData: ReceivedEventData) {}

  /** Creates a new context for a received event. Port of C# `CreateInstance`. */
  static createInstance(eventData: ReceivedEventData): EventHubConsumerContext {
    return new EventHubConsumerContext(eventData);
  }

  /**
   * The result of handling this event. Set by `EventHubConsumerMessageHandlerResultSetter`. Event Hubs
   * has no per-event settlement, so the recorded result only drives the `raiseOnFailureStatus`
   * escalation (and middleware/diagnostics); `undefined` (C# `null`) until a result is recorded.
   */
  messageResult!: IMessageResult;
}
