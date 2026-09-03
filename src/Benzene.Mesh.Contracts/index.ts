/**
 * Port of Benzene.Mesh.Contracts - the shared data shapes (and zero-I/O port interfaces) of the Benzene
 * mesh: the artifacts a mesh aggregator publishes (`manifest.json`, `topics.json`, `usage.json`,
 * `topology.json`, `annotations.json`, per-service snapshots), the `mesh.json` registry + its
 * discovery/serialization helpers, and the seams a service-source/usage-source/report-publisher/discovery
 * adapter implements. Depends only on `@benzenejs/health-checks-core` (for `HealthCheckResponse`), so the
 * rest of the mesh (aggregator, wire, collector, discovery adapters) can build on it.
 *
 * `DateTimeOffset` -> epoch-millisecond `number`; `System.Text.Json.Nodes.JsonObject` -> arbitrary
 * `Record<string, unknown>`; `CancellationToken` -> optional `AbortSignal`; `HMACSHA256` -> `node:crypto`.
 */
export * from './MeshServiceSource';
export * from './MeshServiceStatus';
export * from './MeshTopicStatus';
export * from './MeshTopicChangeKind';
export * from './MeshUsageSource';
export * from './TopologyEdgeSource';

export * from './MeshManifest';
export * from './MeshManifestEntry';
export * from './MeshServiceRegistry';
export * from './MeshServiceRegistryEntry';
export * from './MeshServiceSnapshot';
export * from './MeshServiceReport';
export * from './MeshTopicCatalog';
export * from './MeshTopicEntry';
export * from './MeshTopicService';
export * from './MeshTopicChange';
export * from './MeshRemovedTopic';
export * from './MeshTopicVersionCompatibility';
export * from './MeshServiceVersion';
export * from './MeshUsage';
export * from './MeshUsageEntry';
export * from './MeshAnnotation';
export * from './MeshAnnotationLog';
export * from './MeshAnnotationThread';
export * from './MeshAnnotationRequest';
export * from './MeshTopology';
export * from './TopologyEdge';
export * from './MeshDiscoveryFilter';

export * from './MeshHashing';
export * from './MeshRegistryJson';
export * from './MeshDiscoveryRunner';
export * from './IMeshDiscoveryProvider';
export * from './IMeshUsageSource';
export * from './IMeshReportPublisher';
