import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';

/**
 * Not imported anywhere statically: exists to prove importMessageHandlers
 * discovers and loads handler modules from a directory automatically.
 */
@message('auto-create-order')
export class CreateOrderHandler implements IMessageHandlerNoResponse<{ orderId: string }> {
  handleAsync(): Promise<void> {
    return Promise.resolve();
  }
}
