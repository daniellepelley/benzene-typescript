/** Port of Benzene.Azure.Function.EventHub.Function (barrel). */
export * from './EventHubContext';
export * from './EventHubApplication';
export * from './BenzeneMessageEventHubHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// MESSAGE-TYPE ADAPTATION: the .NET `Azure.Messaging.EventHubs.EventData` maps to the ecosystem-native
// `ReceivedEventData` from `@azure/event-hubs` (the read side of that SDK). The Event Hub package is
// deliberately DIFFERENT in shape from Service Bus/Kafka: its `EventHubContext` carries no message result
// and there are no per-message body/topic/headers getters or result setter. Instead
// `BenzeneMessageEventHubHandler` (a `MiddlewareRouter`) deserializes each event body into a
// `BenzeneMessageRequest` and routes it through the transport-agnostic `BenzeneMessageApplication` — a
// faithful port of the C# `Benzene.Azure.Function.EventHub.Function` package as it actually exists.
//
// DEFERRED: StreamingExtensions.cs (`UseEventHubStream` — the fan-in variant presenting the whole batch as
// a single `StreamContext<EventData>`). It depends on the generic streaming primitives
// `StreamContext<TItem>` / `StreamMiddlewareApplication` from `Benzene.Core.Middleware`, which are NOT yet
// ported to `@benzene/core-middleware`; porting those core primitives is out of scope for this transport
// adapter. Also deferred: the `UseEventHub(IBenzeneApplicationBuilder, ...)` host-neutral overload (see
// `DependencyInjectionExtensions.ts`), the same deferral as the ported ServiceBus/Kafka packages.
