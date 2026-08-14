/** Port of Benzene.Azure.Function.CosmosDb (barrel). */
export * from './StreamingExtensions';
export * from './Extensions';

// FAN-IN (streaming), not fan-out — and generic over the document type: the Cosmos DB Change Feed batch
// is ordered per partition-key range and checkpointed (via the trigger's lease) as a WHOLE batch, so it
// is handed to the pipeline intact as one `StreamContext<TDocument>` (one pipeline run, one DI scope),
// built on the already-ported streaming primitives (`StreamContext` / `StreamMiddlewareApplication` in
// `@benzenejs/core-middleware`) — the Cosmos counterpart to Event Hub's `useEventHubStream` and AWS's
// Kinesis. Unlike the opaque-payload transports, the trigger delivers already-deserialized documents, so
// the entry point/context/pipeline are all generic over `TDocument` rather than routing message
// envelopes. A null/undefined batch is treated as empty (the pipeline still runs once, sees no items).
//
// DEFERRED: the `BenzeneCosmosDbTriggerAttribute` (a source-generator `[assembly:]` declaration with no
// TypeScript counterpart — the same deferral as the Timer/QueueStorage/BlobStorage trigger attributes),
// and the host-neutral `useCosmosDbChangeFeed(IBenzeneApplicationBuilder, ...)` overload (it depends on
// the unported `IBenzeneApplicationBuilder` generic-host abstraction). There is no egress package (Cosmos
// DB is a database, not a transport).
//
// TYPE-ERASURE NOTE: C# routes each document type to its own entry point via runtime generic type checks
// (`app is IEntryPointMiddlewareApplication<IReadOnlyList<TDocument>>`). TypeScript erases `TDocument`, so
// the ported `AzureFunctionApp.handleAsync` dispatches to the FIRST registered fire-and-forget entry
// point regardless of document type (documented on `AzureFunctionApp`). Registering more than one Cosmos
// change-feed entry point in a single app therefore cannot discriminate by type here — the C#
// "two document types route independently" / "unregistered type throws" scenarios rely on that erased
// dispatch and are not ported. The normal single-container case (one change-feed entry point) is faithful.
