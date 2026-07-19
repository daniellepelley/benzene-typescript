import { IBenzeneResultOf } from '@benzene/abstractions';
import { IGetTopic, IMessageSender } from '@benzene/abstractions-messages';
import { IClientMessageRouter } from './IClientMessageRouter';
import { BenzeneClientRequest } from './BenzeneClientRequest';

/**
 * Port of Benzene.Clients.ClientMessageSender&lt;TRequest, TResponse&gt;.
 *
 * An `IMessageSender<TRequest, TResponse>` that routes each send to the `IBenzeneMessageClient`
 * chosen by an `IClientMessageRouter`, on the topic supplied by an `IGetTopic`, wrapping the request
 * in a `BenzeneClientRequest` with empty headers.
 *
 * Erased-type adaptation: C# calls `router.GetClient<TRequest>()` and `getTopic.GetTopic(typeof(TRequest))`.
 * TypeScript erases the request type, so `getClient<TRequest>()`'s type argument carries no runtime
 * effect and `getTopic.getTopic()` is called with no argument — the same adaptation the ported
 * `MessageSender` uses (`DefaultGetTopic` ignores the type anyway).
 */
export class ClientMessageSender<TRequest, TResponse> implements IMessageSender<TRequest, TResponse> {
  constructor(
    private readonly clientMessageRouter: IClientMessageRouter,
    private readonly getTopic: IGetTopic,
  ) {}

  sendMessageAsync(request: TRequest): Promise<IBenzeneResultOf<TResponse>> {
    const client = this.clientMessageRouter.getClient<TRequest>();
    const topic = this.getTopic.getTopic();
    return client.sendMessageAsync<TRequest, TResponse>(
      new BenzeneClientRequest<TRequest>(topic, request, {}),
    );
  }
}
