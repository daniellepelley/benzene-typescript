import {
  IBenzeneResponseAdapter,
  IMessageHandlerResult,
  IResponseHandler,
} from '@benzene/abstractions-message-handlers';

/**
 * Response handler that copies the handler's result status onto the transport response's status code
 * via `IBenzeneResponseAdapter<TContext>.setStatusCode`. Registered by `addBenzeneMessage` alongside
 * `RendererResponseHandler<TContext>` so both body and status are written for every `BenzeneMessage`
 * response.
 * Port of Benzene.Core.MessageHandlers.BenzeneMessage.DefaultResponseStatusHandler&lt;TContext&gt;.
 *
 * `DefaultStatuses` supplies the *error* status codes the pipeline reports on failure; this type is
 * unrelated — it simply propagates whatever status `IMessageHandlerResult.benzeneResult` already
 * carries onto the response.
 */
export class DefaultResponseStatusHandler<TContext> implements IResponseHandler<TContext> {
  constructor(private readonly benzeneResponseAdapter: IBenzeneResponseAdapter<TContext>) {}

  handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    this.benzeneResponseAdapter.setStatusCode(context, messageHandlerResult.benzeneResult.status);
    return Promise.resolve();
  }
}
