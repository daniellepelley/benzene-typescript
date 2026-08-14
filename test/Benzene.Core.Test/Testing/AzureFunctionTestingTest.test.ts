/**
 * The Azure test harness in action: each Azure Functions trigger builder (`@benzenejs/azure-function-testing`)
 * turns a platform-neutral `messageBuilder`/`httpBuilder` into that trigger's native payload, which is then
 * driven through the real Benzene pipeline for that trigger via `InlineAzureFunctionStartUp` + the `handle*`
 * helpers. A green assertion proves the generated payload routes and deserializes.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { InlineAzureFunctionStartUp } from '@benzenejs/azure-function-core';
import { handleHttpRequest, useAzureHttp } from '@benzenejs/azure-function-http';
import { handleServiceBusMessages, useServiceBus } from '@benzenejs/azure-function-service-bus';
import { handleEventHub, useBenzeneMessage, useEventHub } from '@benzenejs/azure-function-event-hub';
import { handleKafkaEvents, useKafka } from '@benzenejs/azure-function-kafka';
import { httpBuilder, messageBuilder } from '@benzenejs/testing';
import {
  asAzureHttpRequest,
  asAzureKafkaEvent,
  asAzureServiceBusMessage,
  asEventHubBenzeneMessage,
} from '@benzenejs/azure-function-testing';

class Order {
  orderId?: string;
}
class OrderResult {
  reference?: string;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderResult })
class CreateOrderHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderResult();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.created(payload));
  }
}

@message('order:placed', { registry, requestType: Order, responseType: OrderResult })
class OrderPlacedHandler implements IMessageHandler<Order, OrderResult> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderResult>> {
    handled.push(request.orderId ?? '<none>');
    return Promise.resolve(BenzeneResult.ok(new OrderResult()));
  }
}

beforeEach(() => {
  handled.length = 0;
});

describe('Azure Functions trigger builders drive the real pipeline', () => {
  it('asAzureHttpRequest routes an HTTP request and returns 201', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) => useAzureHttp(builder, (http) => useMessageHandlers(http, CreateOrderHandler)))
      .build();

    const response = await handleHttpRequest(
      app,
      asAzureHttpRequest(httpBuilder('POST', '/orders', { orderId: '42' })),
    );

    expect(handled).toEqual(['42']);
    expect(response.status).toBe(201);
    expect(JSON.parse(response.body as string)).toEqual({ reference: 'ref-42' });
  });

  it('asAzureServiceBusMessage routes on the topic application property', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) => useServiceBus(builder, (sb) => useMessageHandlers(sb, OrderPlacedHandler)))
      .build();

    await handleServiceBusMessages(app, asAzureServiceBusMessage(messageBuilder('order:placed', { orderId: '7' })));

    expect(handled).toEqual(['7']);
  });

  it('asEventHubBenzeneMessage routes on the envelope topic', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) =>
        useEventHub(builder, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, OrderPlacedHandler))),
      )
      .build();

    await handleEventHub(app, asEventHubBenzeneMessage(messageBuilder('order:placed', { orderId: '9' })));

    expect(handled).toEqual(['9']);
  });

  it('asAzureKafkaEvent routes on the record topic', async () => {
    const app = new InlineAzureFunctionStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((builder) => useKafka(builder, (k) => useMessageHandlers(k, CreateOrderHandler)))
      .build();

    await handleKafkaEvents(app, asAzureKafkaEvent(messageBuilder('create-order', { orderId: '11' })));

    expect(handled).toEqual(['11']);
  });
});
