/**
 * Port of Benzene.Mesh.Dispatch - the opt-in, environment-gated `benzene:mesh:dispatch` handler that invokes ONE
 * registered service's real handler with a caller-supplied payload (the direct-to-consumer test path).
 * Refused in Production unless `MeshDispatchOptions.allowInProduction` is set. Ships the HTTP dispatcher
 * (over an injectable `fetch`); other transports register their own `IMeshServiceDispatcher`.
 *
 * Carries the full .NET guard set: the HTTP-level `MeshDispatchGuardMiddleware` (CSRF header
 * `X-Benzene-Dispatch`, fail-closed identity, request payload bound, per-identity rate limit,
 * envelope-shaped refusals the mesh UI can render) plus the handler-level guards (target validated
 * before the per-target rate limit is charged, every exit path audited — a thrown dispatch audits
 * `dispatch-failed` and RETHROWS), a self-pruning fixed-window `MeshDispatchRateLimiter`, and a
 * response-size cap on the HTTP dispatcher defaulting to the request-side cap, with audit-visible,
 * UTF-8-safe truncation. The .NET guard middleware lives in Benzene.Mesh.Artifacts; the port has no
 * artifacts package, so it lives here — see its placement note.
 */
export * from './MeshDispatchOptions';
export * from './MeshDispatchRequest';
export * from './MeshDispatchEnvelope';
export * from './IMeshDispatchEnvironment';
export * from './IMeshServiceDispatcher';
export * from './MeshDispatchGate';
export * from './MeshDispatchGuardOptions';
export * from './MeshDispatchIdentity';
export * from './MeshDispatchRateLimiter';
export * from './MeshDispatchGuardMiddleware';
export * from './HttpMeshServiceDispatcher';
export * from './MeshDispatchMessageHandler';
export * from './Extensions';
