/**
 * Port of Benzene.Clients — MINIMAL slice: only the HTTP-status-code -> `BenzeneResult` mapping that
 * `@benzene/client-http` needs (`BenzeneResultHttpMapper` + the `convertStatusCode` conversion).
 *
 * DEFERRED (not yet ported) — the entire client-wrapper suite: `ClientBuilder`, `ClientsBuilder`,
 * `IBenzeneMessageClient`, `ClientMessageSender`, the `Retry`/`CorrelationId`/`TraceContext`/`Header`
 * message-client wrappers, `BenzeneMessageClientFactory`, `ClientMapping*`, and
 * `BenzeneResultExtensions.asBenzeneResult`. Several depend on unported distributed-tracing /
 * correlation-id infrastructure (see the roadmap's Diagnostics tracing item), so they are held back
 * until that lands.
 */
export * from './Common/BenzeneResultHttpMapper';
export * from './Common/ClientResultExtensions';
