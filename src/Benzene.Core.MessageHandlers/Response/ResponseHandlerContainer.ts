import {
  IBenzeneResponseAdapter,
  IMessageHandlerResult,
  IResponseHandler,
  IResponseHandlerContainer,
} from '@benzene/abstractions-message-handlers';

/**
 * Default `IResponseHandlerContainer<TContext>` implementation: runs every registered
 * `IResponseHandler<TContext>` in registration order against the handler's result, then finalizes
 * the response via `IBenzeneResponseAdapter<TContext>`.
 * Port of Benzene.Core.MessageHandlers.Response.ResponseHandlerContainer&lt;TContext&gt;.
 */
export class ResponseHandlerContainer<TContext> implements IResponseHandlerContainer<TContext> {
  private readonly responseHandlers: IResponseHandler<TContext>[];

  constructor(
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
    responseHandlers: Iterable<IResponseHandler<TContext>>,
  ) {
    this.responseHandlers = Array.from(responseHandlers);
  }

  async handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    for (const responseHandler of this.responseHandlers) {
      await responseHandler.handleAsync(context, messageHandlerResult);
    }

    await this.responseAdapter.finalizeAsync(context);
  }
}
