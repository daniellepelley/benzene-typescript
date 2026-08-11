/**
 * TypeScript port of Benzene.Clients.InProcess: an in-process outbound transport - dispatches an
 * outbound send straight to a handler registered in the same runtime, in the shared `BenzeneMessage`
 * envelope every transport uses, without going over any wire (no SQS/SNS/HTTP/socket - not even
 * loopback). It exists for the case where functionality that used to live in a different service has
 * been moved into the caller's own service, and the topic that used to be sent over a real transport
 * now has no reason to leave the process.
 *
 * See the cross-language [modular monolith
 * pattern](https://github.com/daniellepelley/Benzene/blob/main/docs/patterns/modular-monolith.md)
 * for the shape this is written toward: many in-process modules, each with its own pipeline,
 * extracted to real services one route at a time.
 *
 * ## PORT DIVERGENCE from .NET (documented in detail on the affected symbol)
 *
 * **Void-only responses.** .NET's single-target `useInProcess(name)` supports real typed
 * request/response, deserializing the dispatched handler's response into the caller's requested
 * `TResponse` (`DefaultBenzeneMessageSender`'s generic `BenzeneMessageClientResponse` fallback).
 * This port's outbound pipeline erases `TResponse` everywhere and has no such deserialization
 * mechanism for *any* transport yet (see `Benzene.Clients/Common/ClientResultExtensions.ts`'s own
 * note that it is deferred) - so both `useInProcess` and `useInProcessFanOut` always produce a
 * `VoidResult`, exactly like `useSqs`/`useSns` already do in this port. See `InProcessContextConverter`.
 *
 * Boot-time route validation, by contrast, IS now ported: `InProcessRouteStartUpCheck` (registered by the
 * first `useInProcess`/`useInProcessFanOut` call) fails start-up if a route names a pipeline nothing
 * registered — the same mistake that was previously only an `InProcessPipelineNotFoundException` at first
 * send.
 */
export * from './DependencyInjectionExtensions';
export * from './DuplicateInProcessFanOutTargetException';
export * from './DuplicateInProcessPipelineException';
export * from './Extensions';
export * from './InProcessClientMiddleware';
export * from './InProcessContextConverter';
export * from './InProcessDispatcherRegistry';
export * from './InProcessFanOutClientMiddleware';
export * from './InProcessFanOutTarget';
export * from './InProcessMessagingAlreadyRegisteredException';
export * from './InProcessMessagingBuilder';
export * from './InProcessPipelineNotFoundException';
export * from './InProcessRequestBuilder';
export * from './InProcessRouteReference';
export * from './InProcessRouteStartUpCheck';
export * from './MissingInProcessPipelineException';
export * from './InProcessSendMessageContext';
