/**
 * Minimal read-only view onto the already-mapped, strongly-typed request for a context type, used
 * where a context already carries a pre-mapped request (so a `RequestMapper` can hand it back
 * directly instead of deserializing the body).
 * Port of Benzene.Abstractions.MessageHandlers.Request.IRequestContext&lt;TRequest&gt;.
 *
 * Deviation: C# detects this with a runtime `context is IRequestContext<TRequest>` type-check.
 * TypeScript interfaces are erased and cannot be tested with `instanceof`, so detection is done by
 * the exported `isRequestContext` duck-typing guard (the context exposes a `request` member). This
 * is a context marker, never resolved from the container, so it declares no `ServiceToken`.
 */
export interface IRequestContext<TRequest> {
  /** The strongly-typed request for the current invocation. */
  readonly request: TRequest;
}

/** Runtime port of C# `context is IRequestContext<TRequest>`. */
export function isRequestContext<TRequest>(context: unknown): context is IRequestContext<TRequest> {
  return typeof context === 'object' && context !== null && 'request' in context;
}
