/**
 * Thrown by `KinesisApplication` when `KinesisOptions.raiseOnFailureStatus` is enabled (the default) and a
 * record's handler reported a failure result, failing the invocation so Lambda retries the batch.
 * TypeScript-only (the .NET binding signals failure through its checkpointer instead).
 */
export class KinesisMessageProcessingException extends Error {
  /** The sequence numbers of the records that failed. */
  readonly sequenceNumbers: string[];

  constructor(sequenceNumbers: string[]) {
    super(
      `Kinesis records ${sequenceNumbers.join(', ')} were not processed successfully; failing the invocation so ` +
        'Lambda retries the batch. Set atMostOnce to acknowledge failures instead.',
    );
    this.name = 'KinesisMessageProcessingException';
    this.sequenceNumbers = sequenceNumbers;
  }
}
