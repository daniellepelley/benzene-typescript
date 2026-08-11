/**
 * A single failed entry within a batch send: its index in the original request collection plus the
 * provider's error code/message, so the caller can identify and retry exactly which message failed.
 * Port of Benzene.Clients.FailedBatchEntry.
 */
export class FailedBatchEntry {
  constructor(
    /** The failed request's index in the original request collection. */
    readonly index: number,
    /** The provider's error code, if any. */
    readonly errorCode: string | undefined,
    /** The provider's error message, if any. */
    readonly errorMessage: string | undefined,
  ) {}
}

/**
 * The outcome of an `IBenzeneBatchMessageClient.sendBatchAsync` call: the entries that failed to send,
 * identified by their index in the original request collection.
 * Port of Benzene.Clients.BatchSendResult.
 */
export class BatchSendResult {
  constructor(
    /** The entries that failed to send, keyed by their index in the request collection. */
    readonly failures: readonly FailedBatchEntry[],
  ) {}

  /** Whether every message in the batch was sent successfully. */
  get allSucceeded(): boolean {
    return this.failures.length === 0;
  }
}
