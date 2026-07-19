import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IBenzeneClientRequest, IGetTopic } from '@benzene/abstractions-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  ClientMessageSender,
  IBenzeneMessageClient,
  IClientMessageRouter,
} from '@benzene/clients';

/**
 * Port of the ClientMessageSender routing scenario: the sender resolves the client from the
 * `IClientMessageRouter`, reads the topic from `IGetTopic`, and returns the routed client's result.
 * Confirms the erased-type adaptation (`getClient()` / `getTopic()` called with no runtime type).
 */

class RecordingClient implements IBenzeneMessageClient {
  received: IBenzeneClientRequest<unknown> | undefined;

  constructor(private readonly result: IBenzeneResultOf<unknown>) {}

  sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    this.received = request;
    return Promise.resolve(this.result as IBenzeneResultOf<TResponse>);
  }

  dispose(): void {}
}

class FakeRouter implements IClientMessageRouter {
  requested = false;
  constructor(private readonly client: IBenzeneMessageClient) {}
  getClient<TRequest>(): IBenzeneMessageClient {
    this.requested = true;
    return this.client;
  }
}

class FixedGetTopic implements IGetTopic {
  constructor(private readonly topic: string) {}
  getTopic(): string {
    return this.topic;
  }
}

class ExampleRequest {
  value = 'hello';
}

describe('ClientMessageSenderTest', () => {
  it('SendMessageAsync_routesToRouterClient_withGetTopicTopic_andReturnsResult', async () => {
    const response = BenzeneResult.ok<ExampleRequest>(new ExampleRequest());
    const inner = new RecordingClient(response);
    const router = new FakeRouter(inner);
    const sender = new ClientMessageSender<ExampleRequest, ExampleRequest>(
      router,
      new FixedGetTopic('client:create'),
    );

    const request = new ExampleRequest();
    const result = await sender.sendMessageAsync(request);

    expect(router.requested).toBe(true);
    expect(result.status).toBe(BenzeneResultStatus.ok);
    // The routed client received a request carrying the topic from IGetTopic and the original message.
    expect(inner.received?.topic).toBe('client:create');
    expect(inner.received?.message).toBe(request);
    expect(inner.received?.headers).toEqual({});
  });
});
