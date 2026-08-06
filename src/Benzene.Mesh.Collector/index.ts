/**
 * Port of Benzene.Mesh.Collector - the spec collector (docs/specification/mesh.md §4-§6): an ordinary
 * Benzene service (dogfooded message handlers) that ingests the mesh wire topics and answers the
 * `mesh:query:*` read models over an in-memory store.
 *
 * `MeshCollectorStore` is the in-memory push-collector plane (cumulative per-service/per-topic stats, latest
 * heartbeat per instance, registered descriptors, and a bounded ring of recent trace events);
 * `CompositeMeshFleetReadModel` is the backend-composed alternative (an `IMeshTraceSource` for flows + one
 * or more `IMeshUsageSource`s for stats). Both implement `IMeshFleetReadModel`, the swappable read seam the
 * five query handlers depend on. `CollectorUsageSource` bridges the store's cumulative stats into the
 * aggregator's `usage.json`. `MeshTimeRangeResolver` resolves the optional Grafana/ISO query time range.
 *
 * Not ported from the .NET original (missing `@benzene/mesh-contracts` prerequisite in this snapshot):
 * threading a `MeshUsageWindow` to the usage sources. See each file header for the exact boundary.
 */
export * from './Views';
export * from './MeshTimeRangeResolver';
export * from './IMeshFleetReadModel';
export * from './IMeshTraceSource';
export * from './MeshCollectorStore';
export * from './CollectorUsageSource';
export * from './CompositeMeshFleetReadModel';
export * from './Handlers';
