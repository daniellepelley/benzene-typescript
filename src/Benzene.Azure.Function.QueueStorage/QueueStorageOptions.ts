/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageOptions. */

/**
 * Configures how `QueueStorageApplication` / `QueueStorageBatchApplication` handle a message
 * handler's exceptions and failure results. Mirrors the C# `QueueStorageOptions` (and, in turn,
 * `KafkaOptions`), keeping the C# defaults: `catchExceptions` off, `raiseOnFailureStatus` on.
 */
export class QueueStorageOptions {
  /**
   * Whether an unhandled exception from a message handler is caught (logged, and the invocation
   * reports success — so the host deletes the message and its poison protection never engages)
   * instead of left to cascade and fail the trigger invocation (so the host's `maxDequeueCount`
   * poison handling applies). Defaults to `false`.
   */
  catchExceptions = false;

  /**
   * Whether a message handler returning a non-exception failure result is escalated into a thrown
   * `QueueStorageMessageProcessingException`, so the failing message is retried/poisoned by the host
   * the same way it would be for an unhandled exception. Defaults to `true` — a returned failure is
   * escalated and redelivered (at-least-once). Set `false` for at-most-once; either way the handler
   * must be idempotent.
   */
  raiseOnFailureStatus = true;

  /**
   * The maximum number of messages from a single batched delivery processed concurrently. `undefined`
   * (the default) leaves the fan-out unbounded. A value `<= 0` is treated the same as `undefined`.
   * Has no effect on the default one-message-per-invocation trigger cardinality.
   */
  maxDegreeOfParallelism?: number;
}
