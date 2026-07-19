import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, ICorrelationId } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult } from '@benzene/results';
import {
  BenzeneClientRequest,
  CorrelationIdBenzeneMessageClient,
  IBenzeneMessageClient,
} from '@benzene/clients';

/**
 * Port of the correlation-id decorator scenario: the current invocation's correlation id is attached
 * to the outgoing request headers before the inner client is called.
 */

/** Records the last request it received. */
class RecordingClient implements IBenzeneMessageClient {
  received: IBenzeneClientRequest<unknown> | undefined;

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.received = request;
    return Promise.resolve(BenzeneResult.ok<TResponse>());
  }

  dispose(): void {}
}

class FixedCorrelationId implements ICorrelationId {
  constructor(private value: string) {}
  set(correlationId: string): void {
    this.value = correlationId;
  }
  get(): string {
    return this.value;
  }
}

describe('CorrelationIdBenzeneMessageClientTest', () => {
  it('SendMessageAsync_attachesCorrelationId_underDefaultKey', async () => {
    const inner = new RecordingClient();
    const client = new CorrelationIdBenzeneMessageClient(inner, new FixedCorrelationId('foo'));

    await client.sendMessageAsync(new BenzeneClientRequest('some-topic', {}, {}));

    expect(inner.received?.topic).toBe('some-topic');
    expect(inner.received?.headers['correlationId']).toBe('foo');
  });

  it('SendMessageAsync_preservesExistingHeaders_andCustomKey', async () => {
    const inner = new RecordingClient();
    const client = new CorrelationIdBenzeneMessageClient(inner, new FixedCorrelationId('bar'), 'x-correlation');

    await client.sendMessageAsync(new BenzeneClientRequest('some-topic', {}, { existing: 'kept' }));

    expect(inner.received?.headers['existing']).toBe('kept');
    expect(inner.received?.headers['x-correlation']).toBe('bar');
  });
});
