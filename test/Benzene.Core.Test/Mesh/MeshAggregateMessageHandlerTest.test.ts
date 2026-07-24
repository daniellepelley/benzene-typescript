import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import {
  FileSystemMeshArtifactStore,
  IMeshServiceSource,
  MeshAggregateMessageHandler,
  MeshAggregator,
} from '@benzene/mesh-aggregator';
import { MeshServiceRegistry, MeshServiceRegistryEntry } from '@benzene/mesh-contracts';

/** Port of test/Benzene.Mesh.Test/MeshAggregateMessageHandlerTest.cs. `Void` -> `VoidResult`. */
describe('MeshAggregateMessageHandler', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-aggregate-handler-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('HandleAsync_DelegatesToAggregatorRunOnceAsync_UsingTheRegisteredRegistry', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([] as IMeshServiceSource[], store);
    const registry = new MeshServiceRegistry([] as MeshServiceRegistryEntry[]);
    const handler = new MeshAggregateMessageHandler(aggregator, registry);

    const result = await handler.handleAsync(new VoidResult());

    expect(result.isSuccessful).toBe(true);
    expect(result.payload.services).toHaveLength(0);
  });
});
