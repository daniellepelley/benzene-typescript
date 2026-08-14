/** Port of Benzene.Mesh.GoogleCloud.Storage.GcsMeshArtifactStore. */
import { Storage } from '@google-cloud/storage';
import { IMeshArtifactStore } from '@benzenejs/mesh-aggregator';

/**
 * An `IMeshArtifactStore` backed by a Google Cloud Storage bucket. Publishes and reads the mesh
 * aggregator's generated artifacts (`manifest.json`, `services/*.json`, `topology.json`, `topics.json`) and
 * the discovery-generated `registry.json` as GCS objects keyed by their relative path - the Google Cloud
 * analogue of the S3-backed (`@benzenejs/mesh-aws-s3`) / Azure-Blob-backed (`@benzenejs/mesh-azure-blob`)
 * stores, so a Cloud-Functions-hosted mesh persists its output centrally where the UI can read it
 * (surviving cold starts / scale-to-zero).
 *
 * `Google.Cloud.Storage.V1` -> `@google-cloud/storage` (the JS-ecosystem equivalent, per the port's
 * third-party adapter rule); `StorageClient.UploadObjectAsync(bucket, key, "application/json", stream)` ->
 * `bucket(bucket).file(key).save(Buffer, { contentType })`; `DownloadObjectAsync(bucket, key, stream)` ->
 * `file.download()` (returns `[Buffer]`); the `MemoryStream` round-trips -> `Buffer`. C#'s
 * `GoogleApiException` with `HttpStatusCode == NotFound` -> the GCS `ApiError` with `code === 404`.
 */
export class GcsMeshArtifactStore implements IMeshArtifactStore {
  private readonly prefix: string;

  /**
   * @param storage The GCS client.
   * @param bucket The bucket artifacts live in.
   * @param prefix An optional object-name prefix (e.g. `"mesh/"`). Defaults to none.
   */
  constructor(
    private readonly storage: Storage,
    private readonly bucket: string,
    prefix = '',
  ) {
    this.prefix = prefix.length === 0 ? '' : prefix.replace(/\/+$/, '') + '/';
  }

  async publishAsync(relativePath: string, content: string): Promise<void> {
    await this.storage
      .bucket(this.bucket)
      .file(this.key(relativePath))
      .save(Buffer.from(content, 'utf8'), { contentType: 'application/json' });
  }

  async tryReadAsync(relativePath: string): Promise<string | undefined> {
    try {
      const [buffer] = await this.storage.bucket(this.bucket).file(this.key(relativePath)).download();
      return buffer.toString('utf8');
    } catch (ex) {
      if (isNotFound(ex)) {
        return undefined;
      }
      throw ex;
    }
  }

  private key(relativePath: string): string {
    return this.prefix + relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  }
}

/** A GCS `ApiError` for a missing object carries `code === 404` (the JS analogue of the C# 404 guard). */
function isNotFound(ex: unknown): boolean {
  return (ex as { code?: number } | null)?.code === 404;
}
