/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageContext. */
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';
import { QueueStorageMessage } from './QueueStorageMessage';

/**
 * Provides the middleware pipeline context for a single Queue Storage message within an Azure
 * Functions Queue Storage trigger invocation. Implements the already-ported `IHasMessageResult` so
 * `QueueStorageMessageHandlerResultSetter` can record the handler outcome onto it, and so
 * `QueueStorageBatchApplication` can read it for `QueueStorageOptions.raiseOnFailureStatus`.
 */
export class QueueStorageContext implements IHasMessageResult {
  /**
   * @param message The Queue Storage message.
   */
  constructor(message: QueueStorageMessage) {
    this.message = message;
  }

  /** The Queue Storage message. */
  readonly message: QueueStorageMessage;

  /**
   * The result of handling this message. The Queue Storage trigger has no per-message settlement (the
   * host deletes the message when the invocation succeeds and retries/poisons it when it throws), so
   * this is recorded for middleware/diagnostics only. Unset (C# `null`) until a result has been
   * recorded — `QueueStorageBatchApplication` reads it via optional chaining, exactly as C# reads
   * `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}
