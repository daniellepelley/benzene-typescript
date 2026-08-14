/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { QueueStorageContext } from './QueueStorageContext';

/**
 * Extracts the message body from a Queue Storage message — its message text. A Queue Storage message
 * has no properties/attributes (the body is the entire message), so this is a straight read of
 * `message.messageText`.
 */
export class QueueStorageMessageBodyGetter implements IMessageBodyGetter<QueueStorageContext> {
  getBody(context: QueueStorageContext): string {
    return context.message.messageText;
  }
}
