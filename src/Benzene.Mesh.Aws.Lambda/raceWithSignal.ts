/**
 * The port of C#'s `Task.WaitAsync(cancellationToken)`: races `promise` against `signal` so a caller's
 * timeout/cancellation still bounds the wait even though the underlying `IAwsLambdaClient.sendMessageAsync`
 * has no cancellation parameter (the in-flight Lambda invoke itself can't be aborted mid-request, the same
 * limitation any awaited network call has). Rejects with the signal's reason when it aborts.
 */
export function raceWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error as Error);
      },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason as unknown;
  return reason instanceof Error ? reason : new Error('The operation was cancelled.');
}
