/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessageHandlerResultSetter. */
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { QueueStorageContext } from './QueueStorageContext';

/**
 * Records a message handler's outcome onto `QueueStorageContext.messageResult`. The Queue Storage
 * trigger has no per-message settlement (success deletes the message, an exception retries it and
 * eventually moves it to the poison queue), so the result is recorded for middleware/diagnostics
 * rather than written back to the transport — but `QueueStorageBatchApplication` reads it to support
 * `QueueStorageOptions.raiseOnFailureStatus`.
 *
 * C# `MessageHandlerResultSetterBase<QueueStorageContext>` (an empty body: `... : Base;`) ports to a
 * trivial subclass of the already-ported `MessageMessageHandlerResultSetterBase`.
 */
export class QueueStorageMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<QueueStorageContext> {}
