import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddleware, IMiddlewareApplicationWithResult, NextFunc } from '@benzene/abstractions-middleware';
import { IBenzeneMessageRequest, IBenzeneMessageResponse } from '@benzene/core-messages';
import { InProcessSendMessageContext } from './InProcessSendMessageContext';

/**
 * Middleware that dispatches the `InProcessSendMessageContext`'s request straight to the in-process
 * message dispatcher registered by `addInProcessMessaging`, and records the response on the context.
 * Port of Benzene.Clients.InProcess.InProcessClientMiddleware.
 *
 * C# `ITerminalMiddleware` has no marker equivalent in the TypeScript pipeline (see
 * `Benzene.Http/BenzeneMessage/BenzeneMessageHttpMiddleware.ts`'s own note) - the short-circuit is
 * simply not calling `next`, as below.
 */
export class InProcessClientMiddleware implements IMiddleware<InProcessSendMessageContext> {
  readonly name = 'InProcessClientMiddleware';

  constructor(
    private readonly dispatcher: IMiddlewareApplicationWithResult<IBenzeneMessageRequest, IBenzeneMessageResponse>,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  async handleAsync(context: InProcessSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.dispatcher.handleAsync(context.request, this.serviceResolverFactory);
  }
}
