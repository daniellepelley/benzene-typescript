/**
 * Thrown by {@link OutboundRoutingBuilder.build} when the same topic was registered via
 * {@link OutboundRoutingBuilder.route} more than once - each topic may only have one outbound route.
 * Port of Benzene.Clients.DuplicateOutboundRouteException.
 */
export class DuplicateOutboundRouteException extends Error {
  /** The topic that was registered more than once. */
  readonly topic: string;

  constructor(topic: string) {
    super(
      `Topic '${topic}' was registered more than once via OutboundRoutingBuilder.route - each topic may only have one outbound route.`,
    );
    this.name = 'DuplicateOutboundRouteException';
    this.topic = topic;
    Object.setPrototypeOf(this, DuplicateOutboundRouteException.prototype);
  }
}
