import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import {
  BenzeneMessageContext,
  BenzeneMessageRequest,
  Constants as MessagesConstants,
} from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  BenzeneMessageGetter,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * End-to-end port of Benzene.Test.Core.Core.BenzeneMessagePipelineTest
 * (test/Benzene.Core.Test/Core/Core/DirectMessagePipelineTest.cs): wire the whole stack via idiomatic
 * DI registration and round-trip a real BenzeneMessage through a decorated handler and back.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildApplication(): { app: BenzeneMessageApplication; container: DefaultBenzeneServiceContainer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(builder, CreateOrderHandler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

function createRequest(topic: string, body: unknown): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = topic;
  request.headers = { sender: 'some-sender' };
  request.body = JSON.stringify(body);
  return request;
}

describe('BenzeneMessagePipelineTest', () => {
  it('Send_RoutesToHandlerAndReturnsOkResponse', async () => {
    const { app, container } = buildApplication();

    const response = await app.handleAsync(
      createRequest('create-order', { orderId: '42' }),
      container.createServiceResolverFactory(),
    );

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    // The body is the handler's serialized OrderCreated payload — a genuine round-trip.
    expect(JSON.parse(response.body)).toEqual({ reference: 'ref-42' });
  });

  it('Send_UnknownTopic_ReturnsNotFoundResponse', async () => {
    const { app, container } = buildApplication();

    const response = await app.handleAsync(
      createRequest('does-not-exist', { orderId: '42' }),
      container.createServiceResolverFactory(),
    );

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(BenzeneResultStatus.notFound);
  });

  it('Send_MissingTopic_MapsToMissingSentinelAndReturnsNotFound', async () => {
    const { app, container } = buildApplication();

    const request = new BenzeneMessageRequest();
    // topic left unset -> BenzeneMessageGetter yields the <missing> sentinel topic, for which no
    // handler is registered, so routing reports NotFound.
    request.headers = {};
    request.body = JSON.stringify({ orderId: '42' });

    const response = await app.handleAsync(request, container.createServiceResolverFactory());

    expect(response.statusCode).toBe(BenzeneResultStatus.notFound);
  });
});

describe('BenzeneMessageGetter', () => {
  it('ExtractsBodyTopicAndHeaders', () => {
    const getter = new BenzeneMessageGetter();
    const request = new BenzeneMessageRequest();
    request.topic = 'some-topic';
    request.body = 'some-message';
    request.headers = { orderId: 'some-order', version: '2.0' };
    const context = new BenzeneMessageContext(request);

    expect(getter.getBody(context)).toBe('some-message');
    expect(getter.getTopic(context)?.id).toBe('some-topic');
    expect(getter.getTopic(context)?.version).toBe('2.0');
    expect(getter.getHeaders(context)).toEqual({ orderId: 'some-order', version: '2.0' });
    expect(new TextDecoder().decode(getter.getBodyBytes(context))).toBe('some-message');
  });

  it('EmptyRequest_YieldsMissingTopicAndEmptyBytes', () => {
    const getter = new BenzeneMessageGetter();
    const context = new BenzeneMessageContext(new BenzeneMessageRequest());

    expect(getter.getTopic(context)?.id).toBe(MessagesConstants.missing.id);
    expect(getter.getBodyBytes(context).length).toBe(0);
  });
});
