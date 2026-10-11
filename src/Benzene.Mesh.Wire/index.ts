/**
 * Port of Benzene.Mesh.Wire - the service side of the mesh wire contract (docs/specification/mesh.md): the
 * shapes a service sends to a collector and the middleware that produces its trace feed.
 *
 * A service's self-description is its Contract Document, served at `benzene:spec` and registered as the body of
 * `benzene:mesh:register` (mesh.md §1-§2) - built by `@benzenejs/schema-openapi`, not here. This package holds
 * the collector's typed reading of that body (`MeshRegistration`), the explicit outbound declarations the
 * document's `events`/`sends` come from (`MeshOutboundRegistry`), the heartbeat, and the trace feed (§3):
 * `MeshTraceEvent`/`MeshTraceBatch`, the ambient `MeshSpan` (W3C trace-context propagation over
 * `AsyncLocalStorage`), the per-transport `IMeshStatusReader`, the lossy batching `HttpMeshTraceExporter`, and the
 * `useMeshTrace` middleware; plus the issue feed (§4.1).
 */
export * from './MeshTopics';
export * from './MeshJson';
export * from './MeshTime';
export * from './MeshRegistration';
export * from './MeshServiceInfo';
export * from './MeshOutboundRegistry';
export * from './MeshTraceEvent';
export * from './MeshIssue';
export * from './MeshSpan';
export * from './IMeshStatusReader';
export * from './IMeshTraceExporter';
export * from './Extensions';
