/** Port of Benzene.Mesh.Aws.S3.Extensions. */
import { S3Client } from '@aws-sdk/client-s3';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { addMeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { S3MeshArtifactStore } from './S3MeshArtifactStore';

/**
 * Registers the mesh aggregator backed by an `S3MeshArtifactStore` over a default-credential-chain
 * `S3Client` (region + credentials resolved from the ambient AWS environment - on Lambda, the execution
 * role), so catalog artifacts and the discovered registry live in the given S3 bucket. C# extension method
 * -> free function.
 *
 * @param services The service container.
 * @param registry The initial registry (usually empty - discovery replaces it at runtime).
 * @param bucket The S3 bucket artifacts are written to/read from.
 * @param prefix An optional key prefix within the bucket.
 */
export function addMeshAggregatorWithS3(
  services: IBenzeneServiceContainer,
  registry: MeshServiceRegistry,
  bucket: string,
  prefix = '',
): IBenzeneServiceContainer {
  const s3 = new S3Client({});
  return addMeshAggregator(services, registry, () => new S3MeshArtifactStore(s3, bucket, prefix));
}
