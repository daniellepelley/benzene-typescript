import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import { BenzeneResult } from '@benzene/results';
import {
  HeaderBenzeneMessageClient,
  IBenzeneMessageClient,
  sendMessageAsync,
} from '@benzene/clients';

/**
 * Port of Benzene.Test.Clients.HeaderBenzeneMessageClientTest: the fixed (key, value) header is
 * stamped onto every outgoing request, whether or not the caller supplied headers. Exercises the
 * `sendMessageAsync` free function (the C# `ClientExtensions.SendMessageAsync` overloads).
 */

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

describe('HeaderBenzeneMessageClientTest', () => {
  it('SendMessageAsync_stampsHeader_onEmptyHeaders', async () => {
    const inner = new RecordingClient();
    const client = new HeaderBenzeneMessageClient(inner, 'some-key', 'some-value');

    await sendMessageAsync(client, 'some-topic', {});

    expect(inner.received?.topic).toBe('some-topic');
    expect(inner.received?.headers['some-key']).toBe('some-value');
  });

  it('SendMessageAsync_overwritesHeader_onPopulatedHeaders', async () => {
    const inner = new RecordingClient();
    const client = new HeaderBenzeneMessageClient(inner, 'some-key', 'some-value');

    await sendMessageAsync(client, 'some-topic', {}, { 'some-key': 'old' });

    expect(inner.received?.headers['some-key']).toBe('some-value');
  });
});
