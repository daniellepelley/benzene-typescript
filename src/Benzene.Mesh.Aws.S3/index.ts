/**
 * Port of Benzene.Mesh.Aws.S3 - an `IMeshArtifactStore` backed by an Amazon S3 bucket
 * (`S3MeshArtifactStore`), so a mesh service running as a Lambda persists its aggregator artifacts +
 * discovered registry centrally. Wired via `addMeshAggregatorWithS3`. Adapts `AWSSDK.S3` to the
 * `@aws-sdk/client-s3` JS-ecosystem equivalent.
 */
export * from './S3MeshArtifactStore';
export * from './Extensions';
