import { IBenzeneResultOf, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The single interface business logic depends on to send an outbound message: a topic and a request,
 * nothing else - no service name, no client type, no factory resolution at the call site. Registered by
 * {@link addOutboundRouting}, which builds one outbound pipeline per topic ahead of time.
 * Port of Benzene.Clients.IBenzeneMessageSender.
 */
export interface IBenzeneMessageSender {
  /**
   * Sends `request` on `topic` through that topic's registered outbound pipeline.
   * @param headers Per-call headers (e.g. a caller-supplied correlation/tenant value) - distinct from
   * any headers a route's own middleware adds statically at route-configuration time.
   * @throws UnroutedTopicException No route is registered for `topic`.
   * @throws OutboundResponseTypeMismatchException The route set no usable `IBenzeneResult` response.
   */
  sendAsync<TRequest, TResponse>(
    topic: string,
    request: TRequest,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResultOf<TResponse>>;
}

export const IBenzeneMessageSender: ServiceToken<IBenzeneMessageSender> =
  serviceToken<IBenzeneMessageSender>('IBenzeneMessageSender');
