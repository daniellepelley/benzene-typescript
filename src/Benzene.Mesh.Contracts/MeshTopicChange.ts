/** Port of Benzene.Mesh.Contracts.MeshTopicChange. */

/**
 * One detected difference for a (topic, version) between the previous aggregator run's `topics.json` and
 * this one - the topic-level "what changed" substance a plain contract-drift hash can't give.
 */
export class MeshTopicChange {
  /** @param kind One of `MeshTopicChangeKind`. */
  constructor(
    readonly kind: string,
    readonly description: string,
  ) {}
}
