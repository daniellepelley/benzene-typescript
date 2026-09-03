/** Port of Benzene.Aws.Lambda.EventBridge.EventBridgeMessageProcessingException. */

/**
 * Thrown by `EventBridgeApplication` when `EventBridgeOptions.raiseOnFailureStatus` is enabled and a
 * message handler reported an unsuccessful result without itself throwing — escalating the failure into
 * an exception so the EventBridge rule target's own retry/on-failure policy applies the same way it
 * would for an unhandled exception. C# `Exception` maps to `Error`.
 */
export class EventBridgeMessageProcessingException extends Error {
  /** The EventBridge event id the handler reported a failure for. */
  readonly eventId: string | undefined;

  constructor(eventId: string | undefined) {
    super(`Message handler reported an unsuccessful result for EventBridge event ${eventId}.`);
    this.name = 'EventBridgeMessageProcessingException';
    this.eventId = eventId;
  }
}
