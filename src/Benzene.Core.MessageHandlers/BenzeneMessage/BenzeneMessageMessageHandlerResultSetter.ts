import { IMessageHandlerResult, IResponseHandlerContainer } from '@benzenejs/abstractions-message-handlers';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
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

  /** Records the result on the context (for a binding that settles an envelope), then renders it. */
  override setResultAsync(context: BenzeneMessageContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    context.messageResult = messageHandlerResult.benzeneResult;
    return super.setResultAsync(context, messageHandlerResult);
  }
}
