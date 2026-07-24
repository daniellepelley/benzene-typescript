import { IBenzeneResult, VoidResult } from '@benzene/abstractions';
import { IBenzeneMessageSender } from '@benzene/clients';
import { IResponseEventPublisher } from './IResponseEventPublisher';

/**
 * The default {@link IResponseEventPublisher}: publishes through {@link IBenzeneMessageSender}, so every
 * event topic must have a route registered via `addOutboundRouting(...)` and the route's own middleware
 * (correlation id, retry, ...) applies to the published event. Resolved from the handled message's DI
 * scope, so scoped state like the inbound correlation id flows onto the event's headers.
 * Port of Benzene.ResponseEvents.BenzeneMessageSenderResponseEventPublisher.
 *
 * Event routes are expected to be fire-and-forget transports whose pipelines set a `VoidResult`
 * acknowledgement. A route that produces no `IBenzeneResult` makes the send throw
 * `OutboundResponseTypeMismatchException`, which surfaces as a publish failure - register a custom
 * {@link IResponseEventPublisher} for such routes.
 */
export class BenzeneMessageSenderResponseEventPublisher implements IResponseEventPublisher {
  private readonly sender: IBenzeneMessageSender;

  constructor(sender: IBenzeneMessageSender) {
    this.sender = sender;
  }

  publishAsync(
    eventTopic: string,
    payload: unknown,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResult> {
    return this.sender.sendAsync<unknown, VoidResult>(eventTopic, payload, headers);
  }
}
