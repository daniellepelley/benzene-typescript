/** Port of Benzene.Mesh.Aggregator.ArtifactStoreMeshReportPublisher. */
import { IMeshReportPublisher, MeshServiceReport } from '@benzenejs/mesh-contracts';
import { IMeshArtifactStore } from './IMeshArtifactStore';
import { MeshSnapshotBuilder } from './MeshSnapshotBuilder';

/**
 * The direct-write `IMeshReportPublisher` - turns a self-reported `MeshServiceReport` into a full
 * `MeshServiceSnapshot` (via the same `MeshSnapshotBuilder` a pulled fetch uses, so both compute
 * `MeshServiceSnapshot.contractDrift` identically) and writes it straight into the shared
 * `IMeshArtifactStore` - the same `services/{name}.json` path `MeshAggregator` itself writes to.
 *
 * Fits a reporter colocated with the aggregator's own storage (e.g. sharing a mounted volume in a Docker
 * Compose deployment). A reporter that isn't colocated should use `@benzenejs/mesh-reporting`'s
 * `HttpMeshReportPublisher` instead. `JsonSerializerOptions` (camelCase, indented) -> `JSON.stringify(x, null, 2)`.
 */
export class ArtifactStoreMeshReportPublisher implements IMeshReportPublisher {
  constructor(private readonly store: IMeshArtifactStore) {}

  async publishAsync(report: MeshServiceReport): Promise<void> {
    const snapshot = await MeshSnapshotBuilder.buildAsync(
      this.store,
      report.name,
      report.reportedAtUtc,
      report.specJson,
      report.health,
      report.error,
    );
    await this.store.publishAsync(`services/${report.name}.json`, JSON.stringify(snapshot, null, 2));
  }
}
