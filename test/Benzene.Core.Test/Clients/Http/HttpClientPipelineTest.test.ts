import { createServer } from 'node:http';
import { AddressInfo, Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageSender } from '@benzenejs/abstractions-messages';
import { out } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResultStatus, transportFailureResult, transportFailureStatus } from '@benzenejs/results';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { FetchLike, HttpRequestMessage, useHttpClientToSend } from '@benzenejs/clients-http';

/**
 * End-to-end outbound-send test for @benzenejs/clients-http, mirroring the C# Benzene.Client.Http usage:
 * a `MessageSender` whose client pipeline uses `useHttpClientToSend(verb, path)` sends a request over
 * a STUBBED fetch, and the deserialized/status-mapped `IBenzeneResult` comes back. The transport is a
 * fake `fetch` (per the HttpClient->fetch adaptation) so no real network call happens.
 */

class OuterContext {}

class CreateOrder {
  constructor(public readonly sku: string = 'widget') {}
}

class OrderCreated {
  reference: string | undefined;
}

/** A fake fetch that captures the request it received and returns a canned `Response`. */
function stubFetch(response: Response): { fetchFn: FetchLike; received: () => HttpRequestMessage } {
  let captured: HttpRequestMessage | undefined;
  const fetchFn: FetchLike = (request) => {
    captured = request;
    return Promise.resolve(response);
  };
  return { fetchFn, received: () => captured! };
}

function buildSender(fetchFn: FetchLike) {
  const container = new DefaultBenzeneServiceContainer();
  const outerBuilder = new MiddlewarePipelineBuilder<OuterContext>(container);
  out(outerBuilder, (senders) =>
    senders.createSenderWithResponse<CreateOrder, OrderCreated>((client) =>
      useHttpClientToSend<CreateOrder, OrderCreated>(client, 'POST', 'http://svc/orders', fetchFn),
    ),
  );
  return container.createServiceResolverFactory().createScope();
}

describe('HttpClientPipelineTest', () => {
  it('SendMessage_On200_ReturnsOkWithDeserializedPayload', async () => {
    const { fetchFn, received } = stubFetch(
      new Response(JSON.stringify({ reference: 'ref-42' }), { status: 200 }),
    );

    const scope = buildSender(fetchFn);
    const sender = scope.getService(IMessageSender);
    const result = (await sender.sendMessageAsync(new CreateOrder('widget'))) as IBenzeneResultOf<OrderCreated>;
    scope.dispose();

    // Ok / successful, and the response body round-tripped into the typed payload.
    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect(result.payload).toEqual({ reference: 'ref-42' });

    // The stubbed fetch received the serialized body and the configured verb + path.
    const request = received();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('http://svc/orders');
    expect(JSON.parse(request.body)).toEqual({ sku: 'widget' });
    expect(request.headers['content-type']).toBe('application/json');
  });

  it('SendMessage_On404_MapsToNotFoundAndIsUnsuccessful', async () => {
    const { fetchFn } = stubFetch(new Response(JSON.stringify({}), { status: 404 }));

    const scope = buildSender(fetchFn);
    const sender = scope.getService(IMessageSender);
    const result = (await sender.sendMessageAsync(new CreateOrder())) as IBenzeneResultOf<OrderCreated>;
    scope.dispose();

    expect(result.status).toBe(BenzeneResultStatus.notFound);
    expect(result.isSuccessful).toBe(false);
  });
});

/**
 * transport-bindings.md §1 (spec 1.1): a call that fails before any reply arrives yields a result, not an
 * exception - `timeout` when the client's own deadline elapsed, otherwise `service-unavailable`. These use the
 * real global `fetch` (not a stub), so the errors are the ones undici actually throws.
 */
describe('HttpClientPipelineTest - a call that fails before any reply', () => {
  async function send(fetchFn: FetchLike): Promise<IBenzeneResultOf<OrderCreated>> {
    const scope = buildSender(fetchFn);
    try {
      return (await scope.getService(IMessageSender).sendMessageAsync(new CreateOrder())) as IBenzeneResultOf<OrderCreated>;
    } finally {
      scope.dispose();
    }
  }

  /** A loopback port nothing listens on: bind one, note it, close it. */
  async function closedPort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return port;
  }

  it('a refused connection is service-unavailable, carrying the socket error', async () => {
    const port = await closedPort();
    const result = await send((request) => fetch(`http://127.0.0.1:${port}/orders`, { method: request.method, body: request.body }));

    expect(result.isSuccessful).toBe(false);
    expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(result.errors[0]?.message).toMatch(/ECONNREFUSED/);
  });

  it("the client's own deadline elapsing is timeout", async () => {
    // A server that accepts the request and never answers.
    const sockets = new Set<Socket>();
    const server = createServer(() => undefined);
    server.on('connection', (socket) => sockets.add(socket));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await send((request) =>
        fetch(`http://127.0.0.1:${port}/orders`, { method: request.method, body: request.body, signal: AbortSignal.timeout(50) }),
      );

      expect(result.isSuccessful).toBe(false);
      expect(result.status).toBe(BenzeneResultStatus.timeout);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('an aborted call is timeout too - an AbortSignal is how a fetch is bounded', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await send((request) => fetch('http://127.0.0.1:9/orders', { method: request.method, body: request.body, signal: controller.signal }));

    expect(result.status).toBe(BenzeneResultStatus.timeout);
  });
});

describe('transportFailureStatus', () => {
  it.each([
    ['AbortSignal.timeout', new DOMException('The operation timed out.', 'TimeoutError'), BenzeneResultStatus.timeout],
    ['an abort', new DOMException('This operation was aborted', 'AbortError'), BenzeneResultStatus.timeout],
    ['an undici connect timeout', new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' }) }), BenzeneResultStatus.timeout],
    ['a refused connection', new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }), BenzeneResultStatus.serviceUnavailable],
    ['a reset', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }), BenzeneResultStatus.serviceUnavailable],
    ['a non-Error rejection', 'boom', BenzeneResultStatus.serviceUnavailable],
  ])('%s', (_name, error, expected) => {
    expect(transportFailureStatus(error)).toBe(expected);
    const result = transportFailureResult(error);
    expect(result.status).toBe(expected);
    expect(result.isSuccessful).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it("joins the error's message with its cause's", () => {
    const error = new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') });
    expect(transportFailureResult(error).errors).toEqual([{ message: 'fetch failed: connect ECONNREFUSED 127.0.0.1:1' }]);
  });
});
