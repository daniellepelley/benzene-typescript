/**
 * Thrown by {@link IBenzeneMessageSender.sendAsync} when no outbound route is registered for the given
 * topic. The runtime fallback when a route was never registered via {@link OutboundRoutingBuilder.route}.
 * Port of Benzene.Clients.UnroutedTopicException.
 */
export class UnroutedTopicException extends Error {
  /** The topic that has no registered outbound route. */
  readonly topic: string;

  constructor(topic: string) {
    super(
      `No outbound route is registered for topic '${topic}'. Register one via OutboundRoutingBuilder.route("${topic}", ...).`,
    );
    this.name = 'UnroutedTopicException';
    this.topic = topic;
    Object.setPrototypeOf(this, UnroutedTopicException.prototype);
  }
}
