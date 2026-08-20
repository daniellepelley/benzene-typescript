/**
 * Port of Benzene.CloudService — the batteries-included setup for a Benzene Cloud Service (the code-level
 * counterpart of docs/specification/cloud-service-profile.md). One call, `useBenzeneCloudService("name", …)`,
 * on a hosted HTTP pipeline wires every operational surface the profile requires (R1–R8) at the default
 * service standard paths: the `/benzene/invoke` envelope endpoint, `/benzene/spec`, `/benzene/health` +
 * reserved `benzene:healthcheck` topic, the reserved `benzene:mesh` descriptor topic, the trace feed, and collector
 * registration + heartbeats. Syntactic sugar over the same pipeline builders Benzene Core setup uses.
 *
 * Key TypeScript-port divergences (see the individual files): the outbound `MeshAnnouncer` posts the wire
 * envelope with the global `fetch` (no new dependency); the envelope pipeline nests via `useBenzeneMessage`,
 * which gives it its own DI container to avoid the generic-erasure collision on context-typed services; the
 * eager descriptor uses `RegistryMessageHandlersFinder`; `IAsyncDisposable`+`IDisposable` map to
 * `disposeAsync()`/`dispose()`.
 */
export * from './CloudServicePaths';
export * from './CloudServiceProfileReport';
// Only the configuration interface is public; the concrete `CloudServiceBuilder`, `MeshAnnouncer`, and
// `CloudServiceDescriptorSource` are `internal sealed` in C# and used only within this package (as DI
// tokens / locals in `Extensions.ts`), so they are not re-exported from the barrel.
export type { ICloudServiceBuilder } from './CloudServiceBuilder';
export * from './Extensions';
