/** Port of Benzene.Mesh.Aggregator.MeshSnapshotBuilder. */
import { HealthCheckResponse } from '@benzene/health-checks-core';
import { MeshHashing, MeshServiceSnapshot } from '@benzene/mesh-contracts';
import { IMeshArtifactStore } from './IMeshArtifactStore';

/**
 * Builds a `MeshServiceSnapshot` from a spec/health fetch (or self-reported push), computing the spec hash
 * and comparing it against the previous run's via `IMeshArtifactStore`. Shared by `MeshAggregator` (pulled
 * snapshots) and any `IMeshReportPublisher` that turns a pushed `MeshServiceReport` into the same snapshot
 * shape, so both compute `MeshServiceSnapshot.contractDrift` identically instead of two copies of the logic.
 *
 * The internal C# `static class` becomes a namespace of free functions (the port's "static class -> free
 * functions" rule). Reading back the previous snapshot deserializes only the `specHash` field: `JSON.parse`
 * yields a plain object with that camelCase field, so no class reconstruction is needed.
 */
export const MeshSnapshotBuilder = {
  /**
   * Builds a snapshot, reading the previous run's spec hash from `store` for drift comparison.
   * @param error The exception type name from a failed fetch, or `undefined`.
   */
  async buildAsync(
    store: IMeshArtifactStore,
    name: string,
    fetchedAtUtc: number,
    specJson: string | undefined,
    health: HealthCheckResponse | undefined,
    error: string | undefined,
  ): Promise<MeshServiceSnapshot> {
    const specHash = specJson !== undefined ? MeshHashing.computeHash(specJson) : undefined;
    const previousSpecHash = await tryGetPreviousSpecHashAsync(store, name);
    const contractDrift = specHash !== undefined && previousSpecHash !== undefined && previousSpecHash !== specHash;

    return new MeshServiceSnapshot(name, fetchedAtUtc, specJson, specHash, previousSpecHash, contractDrift, health, error);
  },
};

async function tryGetPreviousSpecHashAsync(store: IMeshArtifactStore, serviceName: string): Promise<string | undefined> {
  const previousJson = await store.tryReadAsync(`services/${serviceName}.json`);
  if (previousJson === undefined) {
    return undefined;
  }

  try {
    const previous = JSON.parse(previousJson) as { specHash?: string } | null;
    return previous?.specHash ?? undefined;
  } catch {
    return undefined;
  }
}
