import { IServiceResolver, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerResult } from '../IMessageHandlerResult';
import { IBenzeneResponseAdapter } from './IBenzeneResponseAdapter';

/**
 * Writes a handler's result onto the transport response in some representation (JSON/XML via the
 * serializer renderer, or something else entirely via a custom implementation). Renderers are
 * evaluated in registration order; the first whose `canRender` returns `true` wins.
 * Port of Benzene.Abstractions.MessageHandlers.Response.IResponseRenderer&lt;TContext&gt;.
 */
export interface IResponseRenderer<TContext> {
  /** Whether this renderer should produce the response for `result`. Port of C# `CanRender`. */
  canRender(context: TContext, result: IMessageHandlerResult, resolver: IServiceResolver): boolean;

  /** Writes the response body (and content type, etc.) onto `response`. Port of C# `RenderAsync`. */
  renderAsync(
    context: TContext,
    result: IMessageHandlerResult,
    response: IBenzeneResponseAdapter<TContext>,
  ): Promise<void>;
}

export const IResponseRenderer: ServiceToken<IResponseRenderer<unknown>> =
  serviceToken<IResponseRenderer<unknown>>('IResponseRenderer');
