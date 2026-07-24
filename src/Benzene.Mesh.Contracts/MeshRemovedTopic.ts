/** Port of Benzene.Mesh.Contracts.MeshRemovedTopic. */

/**
 * A (topic, version) declared somewhere in the previous run's catalog but nowhere in this one - it can't
 * be flagged on a current `MeshTopicEntry` because there no longer is one.
 */
export class MeshRemovedTopic {
  /** @param version The topic's handler version (empty for the unversioned handler). */
  constructor(
    readonly topic: string,
    readonly version: string,
  ) {}
}
