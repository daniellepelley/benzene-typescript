/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessageProcessingException. */

/**
 * Thrown by `QueueStorageBatchApplication` when `QueueStorageOptions.raiseOnFailureStatus` is enabled
 * and a message handler reported an unsuccessful result without itself throwing — escalating the
 * failure into an exception so the Functions host's `maxDequeueCount` retry/poison handling applies
 * the same way it would for an unhandled exception. C# `Exception` maps to `Error`.
 */
export class QueueStorageMessageProcessingException extends Error {
  /** The Queue Storage message id the handler reported a failure for. */
  readonly messageId: string;

  constructor(messageId: string) {
    super(`Message handler reported an unsuccessful result for Queue Storage message ${messageId}.`);
    this.name = 'QueueStorageMessageProcessingException';
    this.messageId = messageId;
  }
}
