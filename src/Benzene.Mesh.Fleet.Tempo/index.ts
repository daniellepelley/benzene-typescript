/**
 * Port of Benzene.Mesh.Fleet.Tempo - the non-AWS reference realisation of the trace-backed fleet reader
 * (alongside `@benzenejs/mesh-fleet-jaeger` and the X-Ray adapter): it answers the mesh's `benzene:mesh:query:trace`,
 * `benzene:mesh:query:correlation`, and the fleet view's recent-flows from **Grafana Tempo's trace API**, reusing
 * the same `CompositeMeshFleetReadModel`, query handlers, and mesh UI - a backend on the `IMeshTraceSource`
 * seam with zero upstream change.
 *
 * Not to be confused with `@benzenejs/mesh-tracing-tempo`: that sibling reads Tempo's **metrics-generator**
 * (service-graph metrics) over PromQL and publishes `topology.json`; **this** package reads Tempo's **trace**
 * API (TraceQL search + trace-by-id, `/api/search` + `/api/traces/{id}`) and serves the live fleet
 * read-models. Different Tempo surface, different job.
 *
 * `TempoTraceSource` implements `IMeshTraceSource` over Tempo's HTTP trace API; `TempoTraceMapper` maps
 * Tempo's OTLP/JSON trace shape (nanosecond times, `batches[].scopeSpans[].spans[]`, dotted OTLP attribute
 * names) into the mesh `MeshTraceEvent` shape. `addTempoFleetReadModel` wires the source +
 * `CompositeMeshFleetReadModel`.
 *
 * `HttpClient` -> injectable `fetch`; `DateTimeOffset` -> epoch-ms `number` (search params converted to
 * epoch **seconds**, matching C# `ToUnixTimeSeconds()`); unix-nano times parsed as `bigint`.
 * `MeshTraceEvent.exceptionType` (mapped from `benzene.exception.type` in the C# original) is not set - this
 * snapshot of `@benzenejs/mesh-wire`'s `MeshTraceEvent` has no such field.
 */
export * from './TempoTraceSourceOptions';
export * from './TempoTraceMapper';
export * from './TempoTraceSource';
export * from './Extensions';
