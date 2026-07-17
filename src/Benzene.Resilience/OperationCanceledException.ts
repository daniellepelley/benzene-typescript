/**
 * Stand-in for .NET's `System.OperationCanceledException`, which has no built-in
 * JavaScript equivalent. `RetryMiddleware`'s default retry predicate excludes it
 * (a cancelled operation is not retried), mirroring the C# default
 * `ex is not OperationCanceledException`.
 */
export class OperationCanceledException extends Error {
  constructor(message = 'The operation was canceled.') {
    super(message);
    this.name = 'OperationCanceledException';
  }
}
