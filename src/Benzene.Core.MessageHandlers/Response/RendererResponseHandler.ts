import { IServiceResolver } from '@benzene/abstractions';
import {
  IBenzeneResponseAdapter,
  IMessageHandlerResult,
  IResponseHandler,
  IResponseRenderer,
} from '@benzene/abstractions-message-handlers';

/**
 * The single `IResponseHandler<TContext>` every transport registers to write response bodies:
 * short-circuits if a body has already been set, otherwise walks the registered
 * `IResponseRenderer<TContext>`s in order and delegates to the first whose `canRender` matches.
 * Port of Benzene.Core.MessageHandlers.Response.RendererResponseHandler&lt;TContext&gt;.
 */
export class RendererResponseHandler<TContext> implements IResponseHandler<TContext> {
  private readonly renderers: IResponseRenderer<TContext>[];

  constructor(
    private readonly benzeneResponseAdapter: IBenzeneResponseAdapter<TContext>,
    renderers: Iterable<IResponseRenderer<TContext>>,
    private readonly serviceResolver: IServiceResolver,
  ) {
    this.renderers = Array.from(renderers);
  }

  async handleAsync(context: TContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    const existingBody = this.benzeneResponseAdapter.getBody(context);
    if (existingBody !== undefined && existingBody !== '') {
      return;
    }

    const renderer = this.renderers.find((r) =>
      r.canRender(context, messageHandlerResult, this.serviceResolver),
    );
    if (renderer === undefined) {
      return;
    }

    await renderer.renderAsync(context, messageHandlerResult, this.benzeneResponseAdapter);
  }
}
