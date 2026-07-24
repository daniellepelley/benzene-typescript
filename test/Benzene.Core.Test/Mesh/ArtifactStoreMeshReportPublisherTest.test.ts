import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthCheckResponse, HealthCheckResult } from '@benzene/health-checks-core';
import { ArtifactStoreMeshReportPublisher, FileSystemMeshArtifactStore } from '@benzene/mesh-aggregator';
import { MeshServiceReport, MeshServiceSnapshot } from '@benzene/mesh-contracts';

/**
 * Port of test/Benzene.Mesh.Test/ArtifactStoreMeshReportPublisherTest.cs. The read-back
 * `JsonSerializer.Deserialize<MeshServiceSnapshot>` becomes `JSON.parse` typed structurally (a plain object
 * with the same camelCase fields), which is all the assertions read.
 */
function healthyResponse(): HealthCheckResponse {
  return new HealthCheckResponse(true, { Simple: HealthCheckResult.createInstance(true, 'Simple') });
}

describe('ArtifactStoreMeshReportPublisher', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-report-publisher-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('PublishAsync_WritesSnapshotToArtifactStore', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const publisher = new ArtifactStoreMeshReportPublisher(store);
    const report = new MeshServiceReport('payments-fn', Date.now(), '{"info":{"title":"payments-fn"}}', healthyResponse(), undefined);

    await publisher.publishAsync(report);

    const snapshotJson = await store.tryReadAsync('services/payments-fn.json');
    expect(snapshotJson).not.toBeUndefined();
    const snapshot = JSON.parse(snapshotJson!) as MeshServiceSnapshot;
    expect(snapshot.name).toBe('payments-fn');
    expect(snapshot.health!.isHealthy).toBe(true);
    expect(snapshot.contractDrift).toBe(false);
  });

  it('PublishAsync_SecondReportWithChangedSpec_DetectsDrift_SameAsAPulledFetchWould', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const publisher = new ArtifactStoreMeshReportPublisher(store);

    await publisher.publishAsync(new MeshServiceReport('payments-fn', Date.now(), '{"info":{"title":"v1"}}', healthyResponse(), undefined));
    await publisher.publishAsync(new MeshServiceReport('payments-fn', Date.now(), '{"info":{"title":"v2"}}', healthyResponse(), undefined));

    const snapshotJson = await store.tryReadAsync('services/payments-fn.json');
    const snapshot = JSON.parse(snapshotJson!) as MeshServiceSnapshot;

    expect(snapshot.contractDrift).toBe(true);
  });
});
