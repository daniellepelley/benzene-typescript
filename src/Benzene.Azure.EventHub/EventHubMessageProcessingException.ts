/** Port of Benzene.Azure.EventHub.EventHubMessageProcessingException. */

/**
 * Thrown by {@link BenzeneEventHubWorker} when `BenzeneEventHubConfig.raiseOnFailureStatus` is enabled
 * and a handler reported an unsuccessful result without itself throwing — escalating the failure into an
 * exception so it's treated exactly like an unhandled exception (the failed event isn't checkpointed, so
 * the partition doesn't advance past it and a restart redelivers it). C# `Exception` maps to `Error`.
 */
export class EventHubMessageProcessingException extends Error {
  /** The sequence number of the event the handler reported a failure for. */
  readonly sequenceNumber: number;
  /** The partition the failing event was on. */
  readonly partitionId: string;

  constructor(sequenceNumber: number, partitionId: string) {
    super(
      `Message handler reported an unsuccessful result for event with sequence number ${sequenceNumber} on partition ${partitionId}.`,
    );
    this.name = 'EventHubMessageProcessingException';
    this.sequenceNumber = sequenceNumber;
    this.partitionId = partitionId;
  }
}
