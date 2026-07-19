import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageSender } from '@benzene/abstractions-messages';
import { out } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResultStatus } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { FetchLike, HttpRequestMessage, useHttpClientToSend } from '@benzene/client-http';

/**
 * End-to-end outbound-send test for @benzene/client-http, mirroring the C# Benzene.Client.Http usage:
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
