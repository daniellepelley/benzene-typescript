/**
 * Stand-in for .NET's `System.OperationCanceledException`, which has no built-in
 * JavaScript equivalent.
 *
 * NOTE: `RetryMiddleware`'s default predicate no longer keys on this type — "is this OUR
 * cancellation?" is decided by the caller's own `AbortSignal` (the .NET R16 #252/#256 rule; an
 * exception's type says nothing about whose cancellation it was). The class remains exported for
 * callers that throw it and for custom `shouldRetry` predicates that want a type-based filter.
 */
export class OperationCanceledException extends Error {
  constructor(message = 'The operation was canceled.') {
    super(message);
    this.name = 'OperationCanceledException';
  }
}
