/**
 * Port of Benzene.Mesh.Fleet.Jaeger - a second non-AWS reference realisation of the trace-backed fleet
 * reader (alongside `@benzenejs/mesh-tracing-tempo`): it answers the mesh's `benzene:mesh:query:trace`,
 * `benzene:mesh:query:correlation`, and the fleet view's recent-flows from a **Jaeger query service**, reusing the
 * same `CompositeMeshFleetReadModel`, query handlers, and mesh UI as the X-Ray/Tempo adapters - a third
 * backend on the `IMeshTraceSource` seam with zero upstream change.
 *
 * `JaegerTraceSource` implements `IMeshTraceSource` over Jaeger's HTTP query API (`/api/traces/{id}`,
 * `/api/traces?service=...`, `/api/services`); `JaegerTraceMapper` maps Jaeger's own trace JSON model
 * (microsecond times, `references` parentage, `processes` service names) into the mesh `MeshTraceEvent`
 * shape. `addJaegerFleetReadModel` wires the source + `CompositeMeshFleetReadModel`.
 *
 * `HttpClient` -> injectable `fetch`; `DateTimeOffset` -> epoch-ms `number`. `MeshTraceEvent.exceptionType`
 * (mapped from `benzene.exception.type` in the C# original) is not set - this snapshot of
 * `@benzenejs/mesh-wire`'s `MeshTraceEvent` has no such field.
 */
export * from './JaegerTraceSourceOptions';
export * from './JaegerTraceMapper';
export * from './JaegerTraceSource';
export * from './Extensions';
