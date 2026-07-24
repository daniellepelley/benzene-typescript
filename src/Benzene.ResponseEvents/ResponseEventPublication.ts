/**
 * The outcome of a matched {@link IResponseEventMapping}: the event topic to publish on and the payload
 * to publish. Produced by {@link IResponseEventMapping.resolve} and consumed by
 * {@link ResponseEventsMiddleware}, which hands it to the registered {@link IResponseEventPublisher}.
 * Port of Benzene.ResponseEvents.ResponseEventPublication.
 */
export class ResponseEventPublication {
  /** The topic id the event should be published on. */
  readonly eventTopic: string;

  /** The event payload (never empty - a mapping with no payload resolves to no publication instead). */
  readonly payload: unknown;

  constructor(eventTopic: string, payload: unknown) {
    this.eventTopic = eventTopic;
    this.payload = payload;
  }
}
