import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  BenzeneClientRequest,
  IBenzeneMessageClient,
  RetryBenzeneMessageClient,
} from '@benzene/clients';

/**
 * Port of Benzene.Test.Clients.RetryAwsLambdaClientTest (the retry decorator's semantics, exercised
 * there against an AWS client — here against a plain fake). A client that fails then succeeds is
 * retried and ultimately returns the success result; attempt counts are asserted.
 */

/** A fake client returning a scripted sequence of results, counting attempts. */
class ScriptedClient implements IBenzeneMessageClient {
  attempts = 0;

  constructor(private readonly results: IBenzeneResultOf<unknown>[]) {}

  sendMessageAsync<TRequest, TResponse>(
    _request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const result = this.results[Math.min(this.attempts, this.results.length - 1)];
    this.attempts++;
    return Promise.resolve(result as IBenzeneResultOf<TResponse>);
  }

  dispose(): void {}
}

const topic = 'some-topic';
const request = () => new BenzeneClientRequest<Record<string, unknown>>(topic, {}, {});

describe('RetryBenzeneMessageClientTest', () => {
  it('Retries_failThenSucceed_returnsSuccess_afterTwoAttempts', async () => {
    const inner = new ScriptedClient([
      BenzeneResult.serviceUnavailable(),
      BenzeneResult.ok(),
    ]);
    const retryClient = new RetryBenzeneMessageClient(inner);

    const result = await retryClient.sendMessageAsync(request());

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(inner.attempts).toBe(2);
  });

  it('Retries_success_firstAttemptOnly', async () => {
    const inner = new ScriptedClient([BenzeneResult.ok()]);
    const retryClient = new RetryBenzeneMessageClient(inner);

    await retryClient.sendMessageAsync(request());

    expect(inner.attempts).toBe(1);
  });

  it('Retries_serviceUnavailable_upToNumberOfRetries', async () => {
    const inner = new ScriptedClient([BenzeneResult.serviceUnavailable()]);
    const retryClient = new RetryBenzeneMessageClient(inner);

    await retryClient.sendMessageAsync(request());

    expect(inner.attempts).toBe(3);
  });

  it('Retries_tooManyRequests_andReturnsTheLastResult', async () => {
    const inner = new ScriptedClient([
      BenzeneResult.setErrors(BenzeneResultStatus.tooManyRequests, 'throttled'),
    ]);
    const retryClient = new RetryBenzeneMessageClient(inner);

    const result = await retryClient.sendMessageAsync(request());

    expect(inner.attempts).toBe(3);
    expect(result.status).toBe(BenzeneResultStatus.tooManyRequests);
    expect(result.errors).toContain('throttled');
  });

  it('DoesNotRetry_timeout_byDefault', async () => {
    const inner = new ScriptedClient([BenzeneResult.set(BenzeneResultStatus.timeout, undefined, false)]);
    const retryClient = new RetryBenzeneMessageClient(inner);

    const result = await retryClient.sendMessageAsync(request());

    expect(inner.attempts).toBe(1);
    expect(result.status).toBe(BenzeneResultStatus.timeout);
  });

  it('Retries_timeout_whenShouldRetryOptsIn', async () => {
    const inner = new ScriptedClient([BenzeneResult.set(BenzeneResultStatus.timeout, undefined, false)]);
    const retryClient = new RetryBenzeneMessageClient(inner, 3, (r: IBenzeneResult) =>
      BenzeneResultStatus.isTransient(r.status),
    );

    await retryClient.sendMessageAsync(request());

    expect(inner.attempts).toBe(3);
  });
});
