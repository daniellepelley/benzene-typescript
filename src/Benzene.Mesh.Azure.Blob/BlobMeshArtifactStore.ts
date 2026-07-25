/** Port of Benzene.Mesh.Azure.Blob.BlobMeshArtifactStore. */
import { ContainerClient, RestError } from '@azure/storage-blob';
import { IMeshArtifactStore } from '@benzene/mesh-aggregator';

/**
 * An `IMeshArtifactStore` backed by an Azure Blob Storage container. Publishes and reads the mesh
 * aggregator's generated artifacts (`manifest.json`, `services/*.json`, `topology.json`, `topics.json`) and
 * the discovery-generated `registry.json` as blobs keyed by their relative path - the Azure analogue of the
 * S3-backed store, so an Azure-hosted mesh persists its output centrally where the UI can read it.
 *
 * `Azure.Storage.Blobs` -> `@azure/storage-blob` (the JS-ecosystem equivalent, per the port's third-party
 * adapter rule); `MemoryStream` upload -> `uploadData(Buffer, ...)`; `DownloadContentAsync` ->
 * `downloadToBuffer()`; `RequestFailedException` with `Status == 404` -> a `RestError` with `statusCode 404`.
 */
export class BlobMeshArtifactStore implements IMeshArtifactStore {
  private readonly prefix: string;

  /**
   * @param container The blob container artifacts live in.
   * @param prefix An optional blob-name prefix (e.g. `"mesh/"`). Defaults to none.
   */
  constructor(
    private readonly container: ContainerClient,
    prefix = '',
  ) {
    this.prefix = prefix.length === 0 ? '' : prefix.replace(/\/+$/, '') + '/';
  }

  async publishAsync(relativePath: string, content: string): Promise<void> {
    const blob = this.container.getBlockBlobClient(this.key(relativePath));
    const buffer = Buffer.from(content, 'utf8');
    await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: 'application/json' } });
  }

  async tryReadAsync(relativePath: string): Promise<string | undefined> {
    const blob = this.container.getBlockBlobClient(this.key(relativePath));
    try {
      const buffer = await blob.downloadToBuffer();
      return buffer.toString('utf8');
    } catch (ex) {
      if (ex instanceof RestError && ex.statusCode === 404) {
        return undefined;
      }
      throw ex;
    }
  }

  private key(relativePath: string): string {
    return this.prefix + relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
}
