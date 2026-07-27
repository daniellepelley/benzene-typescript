/** Port of Benzene.Azure.Function.BlobStorage (barrel). */
export * from './BlobTriggerEvent';
export * from './BlobStorageContext';
export * from './BlobStorageApplication';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// FAITHFUL SHAPE: a blob trigger delivers a file, not a message envelope, so — unlike the routed
// transports — there is no routing dimension: `BlobStorageContext` carries no message result, there are
// no body/topic/headers getters or result setter, and `BlobStorageApplication` runs a single-blob
// `MiddlewareApplication` (one blob-trigger function fires per blob). The pipeline is consumed directly
// with the `useBlob(...)` terminal sugar (the blob counterpart of `useStream(...)`).
//
// MESSAGE-TYPE ADAPTATION: `@azure/functions` exposes no dedicated blob-trigger payload type (the
// trigger hands the callback the raw content bytes + the `{name}` binding), so — exactly as the .NET
// original — the port keeps a bespoke dependency-free `BlobTriggerEvent` (C# `byte[]` -> `Uint8Array`,
// `Encoding.UTF8` -> the built-in `TextDecoder`/`TextEncoder`) rather than depending on an SDK type.
//
// DEFERRED: the `BenzeneBlobTriggerAttribute` (a source-generator `[assembly:]` declaration with no
// TypeScript counterpart — the same deferral as the Timer/QueueStorage trigger attributes), and the
// host-neutral `useBlobStorage(IBenzeneApplicationBuilder, ...)` overload (it depends on the unported
// `IBenzeneApplicationBuilder` generic-host abstraction). The C# `UseBlob(Func<BlobTriggerEvent, Task>)`
// convenience overload is collapsed into the `BlobStorageContext` form — see `Extensions.ts`; the blob
// is reached via `context.blob`. There is no egress package (Blob Storage is a store, not a transport).
