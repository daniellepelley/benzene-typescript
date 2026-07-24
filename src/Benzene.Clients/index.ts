/**
 * Port of Benzene.Clients — the client-wrapper suite for calling Benzene services through a
 * transport-agnostic `IBenzeneMessageClient`.
 *
 * Ported here:
 * - Core types: `IBenzeneMessageClient`, `IClientMessageRouter`, `IClientHeaders` + `ClientHeaders`,
 *   `BenzeneMessageClientResponse`, `BenzeneClientRequest`, `TopicAndServiceKey`.
 * - Routing sender: `ClientMessageSender` (an `IMessageSender` over router + `IGetTopic`).
 * - Decorator model: `DependencyWrapperFactory`, `ClientBuilder`, and the builders/factory
 *   (`ClientsBuilder`, `SingleClientsBuilder`, `BenzeneMessageClientFactory` +
 *   `IBenzeneMessageClientFactory`, `ClientMapping` + `ClientMappingBuilder`).
 * - Portable decorators (+ their `IDependencyWrapper` wrappers where the .NET source has one):
 *   `RetryBenzeneMessageClient`, `CorrelationIdBenzeneMessageClient`, `HeaderBenzeneMessageClient`,
 *   `HeadersBenzeneMessageClient`.
 * - Free-function extensions: `withRetry`, `withCorrelationId`, `sendMessageAsync` /
 *   `sendMessageNoResponseAsync`.
 * - Common: the HTTP-status -> `BenzeneResult` mapping used by `@benzene/client-http`.
 *
 * DEFERRED (not ported): `Benzene.Clients.TraceContext.*` (`TraceContextBenzeneMessageClient` +
 * its wrapper + `WithW3CTraceContext`). These stamp the current `System.Diagnostics.Activity`'s W3C
 * `traceparent`/`tracestate` onto outgoing headers, depending on the deferred Activity-based
 * distributed-tracing surface (only the portable `parseTraceparent` slice is in `@benzene/diagnostics`).
 * They land once a Node tracing/OpenTelemetry abstraction exists — see the README roadmap's tracing item.
 *
 * NOT re-ported: `Benzene.Clients.JsonSerializer` (identical to the already-ported serializer in
 * `@benzene/core-message-handlers`); `Benzene.Clients.BenzeneClientRequest` is shipped locally
 * (identical to the `@benzene/core-messages` copy — see that file's shipped-twice note).
 */
export * from './IBenzeneMessageClient';
export * from './IClientMessageRouter';
export * from './IClientHeaders';
export * from './ClientHeaders';
export * from './BenzeneMessageClientResponse';
export * from './BenzeneClientRequest';
export * from './TopicAndServiceKey';
export * from './ClientMessageSender';
export * from './DependencyWrapperFactory';
export * from './ClientBuilder';
export * from './ClientsBuilder';
export * from './SingleClientsBuilder';
export * from './IBenzeneMessageClientFactory';
export * from './BenzeneMessageClientFactory';
export * from './ClientMapping';
export * from './ClientMappingBuilder';
export * from './RetryBenzeneMessageClient';
export * from './RetryBenzeneMessageClientWrapper';
export * from './HeaderBenzeneMessageClient';
export * from './HeadersBenzeneMessageClient';
export * from './CorrelationId/CorrelationIdBenzeneMessageClient';
export * from './CorrelationId/CorrelationIdBenzeneMessageClientWrapper';
export * from './CorrelationId/Extensions';
export * from './Extensions';
export * from './ClientExtensions';
export * from './Common/BenzeneResultHttpMapper';
export * from './Common/ClientResultExtensions';

// Outbound routing: the topic-addressed `IBenzeneMessageSender` surface (`Benzene.Clients` outbound
// routing) - build one outbound pipeline per topic ahead of time and send by topic. `UseParallel`
// (needs a bounded-fan-out helper not yet ported) and `ValidateOutboundRouting` (assembly-reflection
// over generated-client contracts) are deferred - see the README roadmap.
export * from './IBenzeneMessageSender';
export * from './OutboundContext';
export * from './OutboundRoutingBuilder';
export * from './OutboundRoutingTopics';
export * from './UnroutedTopicException';
export * from './DuplicateOutboundRouteException';
export * from './OutboundResponseTypeMismatchException';
export * from './DependencyInjectionExtensions';
