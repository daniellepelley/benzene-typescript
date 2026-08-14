import { describe, expect, it } from 'vitest';
import type { Storage } from '@google-cloud/storage';
import { GcsMeshArtifactStore } from '@benzenejs/mesh-google-cloud-storage';

/**
 * The GCS-backed mesh artifact store: object-key computation (prefix + relative path, backslash→slash,
 * leading-slash trim) and the 404→undefined read contract, over a hand-rolled `Storage` stub whose
 * `bucket(b).file(k)` records the save and answers the download. Mirrors the semantics of the C#
 * `GcsMeshArtifactStore` (which the .NET suite exercises only indirectly through the aggregator).
 */

/** A saved object the stub captured. */
interface Saved {
  data: Buffer;
  contentType?: string;
}

/**
 * A `Storage` stub: `objects` seeds what `download()` returns (keyed by `bucket/key`); a missing key throws
 * a GCS-shaped `{ code: 404 }`; `throwOnDownload` forces a non-404 error to prove it propagates. `saves`
 * records every `file(key).save(...)` as `bucket/key -> Saved`.
 */
function stubStorage(options: {
  objects?: Record<string, string>;
  throwOnDownload?: unknown;
} = {}): { storage: Storage; saves: Map<string, Saved> } {
  const saves = new Map<string, Saved>();
  const objects = options.objects ?? {};

  const storage = {
    bucket(bucketName: string) {
      return {
        file(key: string) {
          const path = `${bucketName}/${key}`;
          return {
            async save(data: Buffer, opts?: { contentType?: string }): Promise<void> {
              saves.set(path, { data, contentType: opts?.contentType });
            },
            async download(): Promise<[Buffer]> {
              if (options.throwOnDownload !== undefined) {
                throw options.throwOnDownload;
              }
              const content = objects[path];
              if (content === undefined) {
                throw { code: 404, message: 'No such object' };
              }
              return [Buffer.from(content, 'utf8')];
            },
          };
        },
      };
    },
  } as unknown as Storage;

  return { storage, saves };
}

describe('GcsMeshArtifactStore', () => {
  it('publishAsync writes the content as application/json under the relative-path key', async () => {
    const { storage, saves } = stubStorage();
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket');

    await store.publishAsync('manifest.json', '{"ok":true}');

    const saved = saves.get('mesh-bucket/manifest.json');
    expect(saved).toBeDefined();
    expect(saved!.data.toString('utf8')).toBe('{"ok":true}');
    expect(saved!.contentType).toBe('application/json');
  });

  it('applies the prefix (trailing slash trimmed) and normalises the key', async () => {
    const { storage, saves } = stubStorage();
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket', 'mesh/');

    await store.publishAsync('\\services\\orders.json', '{}');

    // prefix "mesh/" + backslash→slash + no leading slash.
    expect([...saves.keys()]).toEqual(['mesh-bucket/mesh/services/orders.json']);
  });

  it('trims a leading slash on the relative path so the key is not double-rooted', async () => {
    const { storage, saves } = stubStorage();
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket', 'mesh');

    await store.publishAsync('/topics.json', '[]');

    expect([...saves.keys()]).toEqual(['mesh-bucket/mesh/topics.json']);
  });

  it('tryReadAsync returns the object content when present', async () => {
    const { storage } = stubStorage({ objects: { 'mesh-bucket/manifest.json': '{"v":1}' } });
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket');

    expect(await store.tryReadAsync('manifest.json')).toBe('{"v":1}');
  });

  it('tryReadAsync returns undefined for a missing object (404)', async () => {
    const { storage } = stubStorage();
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket');

    expect(await store.tryReadAsync('missing.json')).toBeUndefined();
  });

  it('tryReadAsync propagates a non-404 error', async () => {
    const { storage } = stubStorage({ throwOnDownload: { code: 500, message: 'boom' } });
    const store = new GcsMeshArtifactStore(storage, 'mesh-bucket');

    await expect(store.tryReadAsync('manifest.json')).rejects.toMatchObject({ code: 500 });
  });
});
