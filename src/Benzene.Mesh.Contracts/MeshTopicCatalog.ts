/** Port of Benzene.Mesh.Contracts.MeshTopicCatalog. */
import { MeshRemovedTopic } from './MeshRemovedTopic';
import { MeshTopicEntry } from './MeshTopicEntry';
import { MeshTopicVersionCompatibility } from './MeshTopicVersionCompatibility';

/**
 * The `topics.json` shape a mesh aggregator publishes each run: every topic seen across the mesh and which
 * service(s) expose it, plus a per-topic `versionCompatibility` reconciliation for multi-version topics.
 */
export class MeshTopicCatalog {
  readonly removedTopics: MeshRemovedTopic[];
  readonly versionCompatibility: MeshTopicVersionCompatibility[];

  /**
   * @param removedTopics Topics in the previous run's catalog but nowhere in this one; empty on a first run.
   * @param versionCompatibility Per-topic producer-vs-consumer version reconciliation; empty when no skew.
   */
  constructor(
    readonly generatedAtUtc: number,
    readonly topics: MeshTopicEntry[],
    removedTopics: MeshRemovedTopic[] = [],
    versionCompatibility: MeshTopicVersionCompatibility[] = [],
  ) {
    this.removedTopics = removedTopics;
    this.versionCompatibility = versionCompatibility;
  }
}
