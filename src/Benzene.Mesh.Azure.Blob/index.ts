/**
 * Port of Benzene.Mesh.Azure.Blob - an `IMeshArtifactStore` backed by an Azure Blob Storage container
 * (`BlobMeshArtifactStore`), so an Azure-hosted mesh persists its aggregator artifacts + discovered registry
 * centrally. Wired via `addMeshAggregatorWithBlob`. Adapts `Azure.Storage.Blobs`/`Azure.Identity` to the
 * `@azure/storage-blob`/`@azure/identity` JS-ecosystem equivalents.
 */
export * from './BlobMeshArtifactStore';
export * from './Extensions';
