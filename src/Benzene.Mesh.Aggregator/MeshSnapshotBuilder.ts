/** Port of Benzene.Mesh.Aggregator.MeshSnapshotBuilder. */
import { HealthCheckResponse } from '@benzenejs/health-checks-core';
import { MeshServiceSnapshot } from '@benzenejs/mesh-contracts';
import { IMeshArtifactStore } from './IMeshArtifactStore';

/**
 * Builds a `MeshServiceSnapshot` from a spec/health fetch (or self-reported push), reading the spec's hash
 * and comparing it against the previous run's via `IMeshArtifactStore`. The hash is the **served**
 * `contractHash` of the service's Contract Document (contract-document.md §6.1) — the aggregator computes no
 * hash of its own, so its drift flag means exactly what a generated client's drift check means. A spec
 * without one (not a Contract Document, or none fetched) has no hash, and so no drift verdict. Shared by `MeshAggregator` (pulled
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
    const specHash = servedContractHash(specJson);
    const previousSpecHash = await tryGetPreviousSpecHashAsync(store, name);
    const contractDrift = specHash !== undefined && previousSpecHash !== undefined && previousSpecHash !== specHash;

    return new MeshServiceSnapshot(name, fetchedAtUtc, specJson, specHash, previousSpecHash, contractDrift, health, error);
  },
};

/** The served `contractHash` of a fetched spec, or `undefined` when there is none. */
function servedContractHash(specJson: string | undefined): string | undefined {
  if (specJson === undefined) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(specJson) as { contractHash?: unknown } | null;
    return typeof parsed?.contractHash === 'string' ? parsed.contractHash : undefined;
  } catch {
    return undefined;
  }
}

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
