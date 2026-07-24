import { IBenzeneResult, ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * The outbound port {@link ResponseEventsMiddleware} publishes matched events through. Register an
 * implementation per pipeline (see {@link useResponseEvents}); a test fake, a custom fan-out, or an
 * adapter over an outbound message sender.
 * Port of Benzene.ResponseEvents.IResponseEventPublisher.
 *
 * Deviation: the .NET default implementation `BenzeneMessageSenderResponseEventPublisher` wraps the
 * topic-addressed `IBenzeneMessageSender` (`AddOutboundRouting`) surface, which is not yet ported. Until
 * that outbound-routing surface exists in TypeScript, `useResponseEvents` registers no default
 * publisher - the caller registers an `IResponseEventPublisher` (or the middleware throws when a mapping
 * matches). See the README roadmap.
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
