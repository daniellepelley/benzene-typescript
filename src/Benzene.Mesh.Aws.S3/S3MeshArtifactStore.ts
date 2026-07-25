/** Port of Benzene.Mesh.Aws.S3.S3MeshArtifactStore. */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { IMeshArtifactStore } from '@benzene/mesh-aggregator';

/**
 * An `IMeshArtifactStore` backed by an Amazon S3 bucket. Publishes and reads the mesh aggregator's generated
 * artifacts (`manifest.json`, `services/*.json`, `topology.json`) and the discovery-generated
 * `registry.json` as objects keyed by their relative path, so a mesh service running as a Lambda persists
 * its output centrally where the UI can read it.
 *
 * `AWSSDK.S3` -> `@aws-sdk/client-s3` (the JS-ecosystem equivalent, per the port's third-party adapter
 * rule); `PutObjectAsync`/`GetObjectAsync` -> the v3 command pattern (`s3.send(new PutObjectCommand(...))`);
 * the response stream -> `Body.transformToString`; `AmazonS3Exception`/404 -> a `NoSuchKey`/404 error.
 */
export class S3MeshArtifactStore implements IMeshArtifactStore {
  private readonly prefix: string;

  /**
   * @param s3 The S3 client.
   * @param bucket The bucket artifacts live in.
   * @param prefix An optional key prefix (e.g. `"mesh/"`). Defaults to none.
   */
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
    prefix = '',
  ) {
    this.prefix = prefix.length === 0 ? '' : prefix.replace(/\/+$/, '') + '/';
  }

  async publishAsync(relativePath: string, content: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath), Body: content, ContentType: 'application/json' }),
    );
  }

  async tryReadAsync(relativePath: string): Promise<string | undefined> {
    try {
      const response = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(relativePath) }));
      return response.Body === undefined ? '' : await response.Body.transformToString('utf-8');
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

function isNotFound(ex: unknown): boolean {
  const error = ex as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return error?.name === 'NoSuchKey' || error?.$metadata?.httpStatusCode === 404;
}
