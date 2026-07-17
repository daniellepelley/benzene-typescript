import { IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';

/** In a nested directory to prove recursive discovery. */
@message('auto-cancel-order')
export class CancelOrderHandler implements IMessageHandlerNoResponse<{ orderId: string }> {
  handleAsync(): Promise<void> {
    return Promise.resolve();
  }
}
