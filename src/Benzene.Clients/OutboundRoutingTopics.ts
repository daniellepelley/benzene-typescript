/**
 * The set of topics actually registered via {@link OutboundRoutingBuilder} - registered as a singleton
 * by {@link addOutboundRouting} so startup validation can compare it against required topics without
 * re-deriving the routing table.
 * Port of Benzene.Clients.OutboundRoutingTopics.
 */
export class OutboundRoutingTopics {
  /** The registered topics. */
  readonly topics: ReadonlySet<string>;

  constructor(topics: Iterable<string>) {
    this.topics = new Set(topics);
  }
}
