/** Port of Benzene.Azure.Function.EventHub.Function.EventHubMessageProcessingException. */

/**
 * Thrown by `EventHubBatchApplication` when `EventHubOptions.raiseOnFailureStatus` is enabled and a
 * message handler reported an unsuccessful result without itself throwing — escalating the failure
 * into an exception so the Event Hubs trigger's re-delivery applies the same way it would for an
 * unhandled exception. C# `Exception` maps to `Error`.
 */
export class EventHubMessageProcessingException extends Error {
  /** The Event Hub event sequence number the handler reported a failure for. */
  readonly sequenceNumber: string;

  constructor(sequenceNumber: string) {
    super(`Message handler reported an unsuccessful result for Event Hub event ${sequenceNumber}.`);
    this.name = 'EventHubMessageProcessingException';
    this.sequenceNumber = sequenceNumber;
  }
}
