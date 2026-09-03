/** Port of Benzene.Clients.Azure.QueueStorage.QueueStorageClientMiddleware. */
import { QueueClient } from '@azure/storage-queue';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { QueueStorageSendMessageContext } from './QueueStorageSendMessageContext';

/**
 * Terminal middleware that sends the context's text via a `QueueClient` and records that the send
 * completed. It does not call `next`. `QueueClient.SendMessageAsync` → `queueClient.sendMessage(text)`.
 */
export class QueueStorageClientMiddleware implements IMiddleware<QueueStorageSendMessageContext> {
  readonly name = 'QueueStorageClientMiddleware';

  constructor(private readonly queueClient: QueueClient) {}

  async handleAsync(context: QueueStorageSendMessageContext, _next: NextFunc): Promise<void> {
    // The context's abort signal (if set) aborts the in-flight send rather than running it to completion.
    await this.queueClient.sendMessage(context.messageText, { abortSignal: context.signal });
    context.isSent = true;
  }
}
