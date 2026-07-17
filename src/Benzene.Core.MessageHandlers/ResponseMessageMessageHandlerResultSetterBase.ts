import {
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
  IResponseHandlerContainer,
} from '@benzene/abstractions-message-handlers';

/**
 * Base `IMessageHandlerResultSetter<TContext>` for transports that report a handler's outcome by
 * writing a response back through the pipeline's registered `IResponseHandler<TContext>`s (headers,
 * status code, body) — e.g. HTTP-style or direct request/response transports such as `BenzeneMessage`.
 * Port of Benzene.Core.MessageHandlers.ResponseMessageMessageHandlerResultSetterBase&lt;TContext&gt;.
 *
 * The doubled "Message" in the name is deliberate (not a typo): it is a setter that implements
 * `IMessageHandlerResultSetter<TContext>` (the "MessageHandlerResultSetter" part) by writing the
 * outbound message/response (the "Message" part) via an `IResponseHandlerContainer<TContext>`, as
 * opposed to `MessageMessageHandlerResultSetterBase<TContext>`, which records a simple pass/fail
 * outcome onto the context instead of producing a response.
 */
export class ResponseMessageMessageHandlerResultSetterBase<TContext>
  implements IMessageHandlerResultSetter<TContext>
{
  constructor(private readonly responseHandlerContainer: IResponseHandlerContainer<TContext>) {}

  async setResultAsync(
    context: TContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void> {
    await this.responseHandlerContainer.handleAsync(context, messageHandlerResult);
  }
}
