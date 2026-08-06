/**
 * Port of Benzene.Mesh.GoogleCloud.Storage - an `IMeshArtifactStore` backed by a Google Cloud Storage
 * bucket (`GcsMeshArtifactStore`), so a Cloud-Functions-hosted mesh persists its aggregator artifacts +
 * discovered registry centrally where the UI can read it. Wired via `addMeshAggregatorWithGcs`, the Google
 * Cloud analogue of `addMeshAggregatorWithS3` (`@benzene/mesh-aws-s3`) / `addMeshAggregatorWithBlob`
 * (`@benzene/mesh-azure-blob`). Adapts `Google.Cloud.Storage.V1` to the `@google-cloud/storage`
 * JS-ecosystem equivalent (the same package `@benzene/clients-google-cloud-pubsub` uses for its own GCP
 * SDK), completing the cloud artifact-store trio.
 */
export * from './GcsMeshArtifactStore';
export * from './Extensions';
