import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { IBenzeneMessageClient } from './IBenzeneMessageClient';

/**
 * Port of Benzene.Clients.RetryBenzeneMessageClient.
 *
 * Decorates an `IBenzeneMessageClient` with a simple retry loop. By default it retries results whose
 * status is `ServiceUnavailable` or `TooManyRequests` — transient conditions where the request was
 * not processed. `Timeout` is deliberately NOT retried by default (a timed-out operation may have
 * been applied); opt in via the `shouldRetry` predicate (e.g.
 * `(r) => BenzeneResultStatus.isTransient(r.status)`).
 *
 * C#'s two constructors (with/without `shouldRetry`) collapse into one with an optional predicate.
 * The C# default `result.IsServiceUnavailable() || result.IsTooManyRequests()` — each a
 * `Status == ...` comparison — is ported as a status equality check.
 */
export class RetryBenzeneMessageClient implements IBenzeneMessageClient {
  private readonly shouldRetry: (result: IBenzeneResult) => boolean;

  constructor(
    private readonly inner: IBenzeneMessageClient,
    private readonly numberOfRetries: number = 3,
    shouldRetry?: (result: IBenzeneResult) => boolean,
  ) {
    this.shouldRetry = shouldRetry ?? RetryBenzeneMessageClient.defaultShouldRetry;
  }

  private static defaultShouldRetry(result: IBenzeneResult): boolean {
    return (
      result.status === BenzeneResultStatus.serviceUnavailable ||
      result.status === BenzeneResultStatus.tooManyRequests
    );
  }

  dispose(): void {
    this.inner.dispose();
  }

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    let result: IBenzeneResultOf<TResponse> = BenzeneResult.serviceUnavailable<TResponse>();
    for (let i = 0; i < this.numberOfRetries; i++) {
      result = await this.inner.sendMessageAsync<TRequest, TResponse>(request);
      if (!this.shouldRetry(result)) {
        return result;
      }
    }

    // Exhausted: return the last result rather than synthesizing a fresh one, so the caller keeps
    // the true status and any errors it carried.
    return result;
  }
}
