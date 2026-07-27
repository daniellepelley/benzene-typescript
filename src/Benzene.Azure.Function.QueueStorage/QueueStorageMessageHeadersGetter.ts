/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { QueueStorageContext } from './QueueStorageContext';

/**
 * Provides the headers for a Queue Storage message — always empty, because Queue Storage messages
 * have no properties/attributes (the body is the entire message). Headers carried inside a Benzene
 * message envelope body are surfaced by the `useBenzeneMessage` path instead.
 */
export class QueueStorageMessageHeadersGetter implements IMessageHeadersGetter<QueueStorageContext> {
  getHeaders(_context: QueueStorageContext): Record<string, string> {
    return {};
  }
}
