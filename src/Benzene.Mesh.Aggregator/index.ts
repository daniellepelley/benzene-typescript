/**
 * Port of Benzene.Mesh.Aggregator - the polling mesh aggregator: `MeshAggregator` fetches every registered
 * service's spec/health (via an `IMeshServiceSource`), computes contract-drift and a cross-service topic
 * catalog/topology/composite-AsyncAPI, and publishes the artifacts to an `IMeshArtifactStore`
 * (`FileSystemMeshArtifactStore` ships). Also the push path (`ArtifactStoreMeshReportPublisher` +
 * `MeshReportMessageHandler`), the discussion write path (`MeshAnnotationPublisher` +
 * `MeshAnnotationsMessageHandler`), and `addMeshAggregator` wiring.
 */
export * from './IMeshArtifactStore';
export * from './IMeshServiceSource';
export * from './UnknownMeshServiceSource';
export * from './FileSystemMeshArtifactStore';
export * from './HttpMeshServiceSource';
export * from './MeshSnapshotBuilder';
export * from './ArtifactStoreMeshReportPublisher';
export * from './MeshAnnotationPublisher';
export * from './AsyncApiCompositor';
export * from './MeshAggregator';
export * from './MeshAggregateMessageHandler';
export * from './MeshReportMessageHandler';
export * from './MeshAnnotationsMessageHandler';
export * from './Extensions';
