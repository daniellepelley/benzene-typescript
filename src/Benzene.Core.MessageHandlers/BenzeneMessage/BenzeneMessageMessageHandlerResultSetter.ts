import { IResponseHandlerContainer } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { ResponseMessageMessageHandlerResultSetterBase } from '../ResponseMessageMessageHandlerResultSetterBase';

/**
 * The `BenzeneMessage` transport's `IMessageHandlerResultSetter<BenzeneMessageContext>`: writes the
 * handler's result as a `BenzeneMessageContext` response, via the shared
 * `ResponseMessageMessageHandlerResultSetterBase<BenzeneMessageContext>` behavior (see that type for
 * why "Message" appears twice in the name). Registered by `addBenzeneMessage`.
 * Port of Benzene.Core.MessageHandlers.BenzeneMessage.BenzeneMessageMessageHandlerResultSetter.
 */
export class BenzeneMessageMessageHandlerResultSetter extends ResponseMessageMessageHandlerResultSetterBase<BenzeneMessageContext> {
  constructor(responseHandlerContainer: IResponseHandlerContainer<BenzeneMessageContext>) {
    super(responseHandlerContainer);
  }
}
