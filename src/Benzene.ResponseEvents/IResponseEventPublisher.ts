import { IBenzeneResult, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The outbound port {@link ResponseEventsMiddleware} publishes matched events through. The default
 * implementation ({@link BenzeneMessageSenderResponseEventPublisher}) sends via `IBenzeneMessageSender`'s
 * outbound routing; replace the scoped registration to publish differently (a test fake, a custom
 * fan-out, or a transactional outbox relay).
 * Port of Benzene.ResponseEvents.IResponseEventPublisher.
 */
export interface IResponseEventPublisher {
  /**
   * Publishes one response event.
   * @param eventTopic The topic id to publish on.
   * @param payload The event payload.
   * @param headers Optional per-event headers.
   * @returns The outcome of the publish; an unsuccessful result is treated as a publish failure.
   */
  publishAsync(
    eventTopic: string,
    payload: unknown,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResult>;
}

export const IResponseEventPublisher: ServiceToken<IResponseEventPublisher> =
  serviceToken<IResponseEventPublisher>('IResponseEventPublisher');
