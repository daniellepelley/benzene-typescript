/** Port of Benzene.Azure.Function.EventHub.Function.EventHubMessageProcessingException. */

/**
 * Thrown by `EventHubApplication` when `EventHubOptions.raiseOnFailureStatus` is enabled (the default) and
 * an event's handler reported a failure result, failing the invocation so the batch is not checkpointed.
 */
export class EventHubMessageProcessingException extends Error {
  readonly sequenceNumber: number | undefined;

  constructor(sequenceNumber: number | undefined) {
    super(
      `Event Hub event ${sequenceNumber ?? '<unknown>'} was not processed successfully; failing the invocation so ` +
        'the batch is not checkpointed past it. Set atMostOnce to acknowledge failures instead.',
    );
    this.name = 'EventHubMessageProcessingException';
    this.sequenceNumber = sequenceNumber;
  }
}
