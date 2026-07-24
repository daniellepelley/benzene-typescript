import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileSystemMeshArtifactStore } from '@benzene/mesh-aggregator';

/**
 * Port of test/Benzene.Mesh.Test/FileSystemMeshArtifactStoreTest.cs. `IDisposable` temp-dir cleanup ->
 * `beforeEach`/`afterEach`; `UnauthorizedAccessException` -> a thrown `Error` (the port's traversal guard).
 */
describe('FileSystemMeshArtifactStore', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('TryReadAsync_NothingPublished_ReturnsUndefined', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);

    expect(await store.tryReadAsync('manifest.json')).toBeUndefined();
  });

  it('PublishAsync_ThenTryReadAsync_RoundTrips', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);

    await store.publishAsync('manifest.json', '{"hello":"world"}');

    expect(await store.tryReadAsync('manifest.json')).toBe('{"hello":"world"}');
  });

  it('PublishAsync_NestedRelativePath_CreatesDirectory', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);

    await store.publishAsync('services/orders-api.json', '{}');

    expect(await store.tryReadAsync('services/orders-api.json')).toBe('{}');
  });

  it('PublishAsync_Overwrite_ReplacesContent', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);

    await store.publishAsync('manifest.json', '{"version":1}');
    await store.publishAsync('manifest.json', '{"version":2}');

    expect(await store.tryReadAsync('manifest.json')).toBe('{"version":2}');
  });

  it.each(['../escape.json', 'services/../../escape.json', '../../etc/passwd'])(
    'PublishAsync_PathEscapingRoot_IsRejected (%s)',
    async (relativePath) => {
      // The relative path can carry a service name from an untrusted push report, so a traversal
      // sequence must not let a write escape the store root.
      const store = new FileSystemMeshArtifactStore(rootDirectory);

      await expect(store.publishAsync(relativePath, '{}')).rejects.toThrow(/resolves outside the store root/);
    },
  );

  it('TryReadAsync_PathEscapingRoot_IsRejected', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);

    await expect(store.tryReadAsync('../../etc/passwd')).rejects.toThrow(/resolves outside the store root/);
  });
});
