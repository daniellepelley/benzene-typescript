/** Port of Benzene.Mesh.Aggregator.IMeshArtifactStore. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Publishes (and reads back) the JSON artifacts a `MeshAggregator` produces.
 *
 * Kept as a small port so a blob-storage adapter (S3, Azure Blob) can be added later as a drop-in
 * implementation of this interface, without changing `MeshAggregator`'s own logic. Only a local-disk
 * implementation (`FileSystemMeshArtifactStore`) ships in this package.
 */
export interface IMeshArtifactStore {
  /**
   * Writes `content` to `relativePath`, creating or overwriting it.
   * @param relativePath A path relative to the store's root, e.g. `"manifest.json"` or `"services/orders-api.json"`.
   * @param content The content to write.
   */
  publishAsync(relativePath: string, content: string): Promise<void>;

  /**
   * Reads the content previously published at `relativePath`, if any.
   * @param relativePath A path relative to the store's root.
   * @returns The content, or `undefined` if nothing has been published at that path.
   */
  tryReadAsync(relativePath: string): Promise<string | undefined>;
}

/** Container token: the aggregator resolves the configured artifact store by this interface. */
export const IMeshArtifactStore: ServiceToken<IMeshArtifactStore> =
  serviceToken<IMeshArtifactStore>('IMeshArtifactStore');
