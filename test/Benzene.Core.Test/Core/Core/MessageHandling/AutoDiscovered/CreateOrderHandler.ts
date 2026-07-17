import { IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message } from '@benzene/core-message-handlers';

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
