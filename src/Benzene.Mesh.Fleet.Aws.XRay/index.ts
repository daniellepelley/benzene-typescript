/**
 * Port of Benzene.Mesh.Fleet.Aws.XRay - the AWS realisation of the trace-backed fleet reader (alongside
 * `@benzene/mesh-fleet-tempo` and `@benzene/mesh-fleet-jaeger`): it answers the mesh's `mesh:query:trace`,
 * `mesh:query:correlation`, and the fleet view's recent-flows from **AWS X-Ray**, reusing the same
 * `CompositeMeshFleetReadModel`, query handlers, and mesh UI - a backend on the `IMeshTraceSource` seam with
 * zero upstream change.
 *
 * `XRayTraceSource` implements `IMeshTraceSource` over the X-Ray SDK (`BatchGetTraces` by id,
 * `GetTraceSummaries` for correlation/recent-flows); `XRaySegmentMapper` maps X-Ray's segment-document JSON
 * (annotations with underscore keys or metadata with dotted keys, possibly namespaced) into the mesh
 * `MeshTraceEvent` shape. `addXRayFleetReadModel` wires the source + `CompositeMeshFleetReadModel`.
 *
 * Divergences from the C# original (see also each file's header):
 * - `IAmazonXRay` -> the `@aws-sdk/client-xray` `XRayClient`. `_xray.BatchGetTracesAsync(req)` /
 *   `_xray.GetTraceSummariesAsync(req)` -> `xray.send(new BatchGetTracesCommand(input))` /
 *   `xray.send(new GetTraceSummariesCommand(input))`. The v3 SDK uses PascalCase shape members
 *   (`TraceIds`/`Traces`/`Segments`/`Document`/`TraceSummaries`/`NextToken`/`Duration`/`HasError`/…), so the
 *   request/response shapes map almost 1:1 to the C#; `StartTime`/`EndTime` are JS `Date`.
 * - C# two constructors (`(IAmazonXRay)` defaulting options, `(IAmazonXRay, options)`) -> one constructor
 *   `(xray, options = new XRayTraceSourceOptions())`.
 * - `System.Text.Json.JsonDocument` -> `JSON.parse` + `unknown` type guards; `DateTimeOffset` -> epoch-ms
 *   `number`; an unparseable trace-id epoch falls back to `0` (the epoch, the ordering analog of C#
 *   `DateTimeOffset.MinValue`). `CancellationToken` -> optional `AbortSignal` (threaded to `send` as
 *   `{ abortSignal }`); `Task.WhenAll` -> `Promise.all`; `StringComparer.Ordinal` -> an ordinal compare.
 * - `addXRayFleetReadModel` constructs `new XRayClient({})` inside the `IMeshTraceSource` factory rather than
 *   resolving a container-registered `IAmazonXRay` (there is no ambient AWS client token in the TS DI), the
 *   same pattern as the `addSqs*` extensions.
 * - Unlike the Tempo/Jaeger ports, `MeshTraceEvent.exceptionType` IS carried here: this port adds the
 *   `exceptionType` field to `@benzene/mesh-wire`'s `MeshTraceEvent` (it was missing from the snapshot), and
 *   the mapper reads `benzene.exception.type` into it (spec §3 "the failure's WHY").
 */
export * from './XRayTraceSourceOptions';
export * from './XRaySegmentMapper';
export * from './XRayTraceSource';
export * from './Extensions';
