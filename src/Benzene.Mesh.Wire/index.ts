/**
 * Port of Benzene.Mesh.Wire - the ServiceDescriptor path of the mesh wire contract
 * (docs/specification/mesh.md §2): a service's normative, self-derived description of the topics it
 * serves, its identity/placement, and a per-port contract hash, plus the middleware that serves it
 * over the reserved `mesh` topic (§1). This is the cross-language self-description a collector reads
 * to catalog a service - the same shape a .NET, Go, or TypeScript service emits.
 *
 * `MeshServiceDescriptor` and friends are derived by `MeshDescriptorFactory.create` from the live
 * `IMessageHandlerDefinitionLookUp`; `useMeshDescriptor` intercepts the reserved topic and returns
 * it. Where the C# original reflects over CLR types for §2.1 schemas, this port injects an
 * `IMeshSchemaProvider` (types are erased at runtime) - see `MeshSchemaProvider`.
 *
 * `runtime` defaults to `"node"`; the §2.2 `descriptorHash` uses `node:crypto` SHA-256 over the
 * spec's canonical JSON (fixed descriptor field order, lexicographic schema-map keys).
 *
 * The trace feed (§3) is also here: `MeshTraceEvent`/`MeshTraceBatch`/`MeshHeartbeat`, the ambient
 * `MeshSpan` (W3C trace-context propagation over `AsyncLocalStorage`), the per-transport
 * `IMeshStatusReader`, the lossy batching `HttpMeshTraceExporter`, and the `useMeshTrace` middleware.
 */
export * from './MeshTopics';
export * from './MeshJson';
export * from './MeshServiceDescriptor';
export * from './MeshServiceInfo';
export * from './MeshSchemaProvider';
export * from './ValidationMeshSchemaProvider';
export * from './MeshDescriptorFactory';
export * from './MeshTraceEvent';
export * from './MeshIssue';
export * from './MeshSpan';
export * from './IMeshStatusReader';
export * from './IMeshTraceExporter';
export * from './Extensions';
