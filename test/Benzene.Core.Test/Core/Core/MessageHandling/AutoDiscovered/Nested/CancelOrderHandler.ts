import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';

/** In a nested directory to prove recursive discovery. */
@message('auto-cancel-order')
export class CancelOrderHandler implements IMessageHandlerNoResponse<{ orderId: string }> {
  handleAsync(): Promise<void> {
    return Promise.resolve();
  }
}
