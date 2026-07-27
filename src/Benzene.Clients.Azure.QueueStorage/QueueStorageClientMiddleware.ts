/** Port of Benzene.Clients.Azure.QueueStorage.QueueStorageClientMiddleware. */
import { QueueClient } from '@azure/storage-queue';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { QueueStorageSendMessageContext } from './QueueStorageSendMessageContext';

/**
 * Terminal middleware that sends the context's text via a `QueueClient` and records that the send
 * completed. It does not call `next`. `QueueClient.SendMessageAsync` → `queueClient.sendMessage(text)`.
 */
export class QueueStorageClientMiddleware implements IMiddleware<QueueStorageSendMessageContext> {
  readonly name = 'QueueStorageClientMiddleware';

  constructor(private readonly queueClient: QueueClient) {}

  async handleAsync(context: QueueStorageSendMessageContext, _next: NextFunc): Promise<void> {
    await this.queueClient.sendMessage(context.messageText);
    context.isSent = true;
  }
}
