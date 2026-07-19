import { IBenzeneResult, IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';
import { BenzeneClientRequest } from './BenzeneClientRequest';

/**
 * Port of Benzene.Clients.ClientExtensions.
 *
 * C# extension methods on `IBenzeneMessageClient` -> free functions taking the client first.
 *
 * Name split: C# overloads all three helpers as `SendMessageAsync`. The two typed-response overloads
 * (with/without `headers`) collapse into `sendMessageAsync` (optional `headers`, defaulting to `{}`).
 * The third — `SendMessageAsync<TRequest>(topic, request)` returning a payload-less `IBenzeneResult`
 * (over C# `Void`) — collides by generic arity, so it is renamed `sendMessageNoResponseAsync`,
 * mirroring the `IMessageSenderNoResponse` / `createSender` precedents. C# `Void` -> `VoidResult`.
 */
export function sendMessageAsync<TMessage, TResponse>(
  source: IBenzeneMessageClient,
  topic: string,
  message: TMessage,
  headers: Record<string, string> = {},
): Promise<IBenzeneResultOf<TResponse>> {
  return source.sendMessageAsync<TMessage, TResponse>(new BenzeneClientRequest<TMessage>(topic, message, headers));
}

export async function sendMessageNoResponseAsync<TRequest>(
  client: IBenzeneMessageClient,
  topic: string,
  request: TRequest,
): Promise<IBenzeneResult> {
  const clientRequest = new BenzeneClientRequest<TRequest>(topic, request, {});
  return client.sendMessageAsync<TRequest, VoidResult>(clientRequest);
}
