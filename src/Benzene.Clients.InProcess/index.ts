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
 * ## Typed responses & boot-time validation (both now ported)
 *
 * **Typed responses.** `useInProcess(name)` returns the dispatched handler's real, typed response:
 * `InProcessContextConverter` leaves the response envelope on the context and
 * `DefaultBenzeneMessageSender` deserializes its body into the caller's `TResponse`
 * (`sendAsync<TRequest, TResponse>`), the same structural `JSON.parse` mechanism the HTTP client uses. So
 * an in-process route is no longer Void-only. `useInProcessFanOut`, being a broadcast to several targets,
 * stays `VoidResult` — as does every fire-and-forget transport (`useSqs`/`useSns`), which has no response
 * body to type. See `InProcessContextConverter`.
 *
 * **Boot-time route validation.** `InProcessRouteStartUpCheck` (registered by the first
 * `useInProcess`/`useInProcessFanOut` call) fails start-up if a route names a pipeline nothing registered —
 * the mistake that was previously only an `InProcessPipelineNotFoundException` at first send.
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
