/**
 * The startup-host harness for Google Cloud Functions HTTP in action — the GCP peer of
 * `BenzeneTestHostTest` (AWS/Azure). Boot the REAL startup from `benzeneTestHost(...)`, override any
 * dependency with `.withServices(...)`, finish with the ONE GCP-specific line `buildGoogleCloudFunctionHost`,
 * turn a neutral `httpBuilder(...)` into the native Functions Framework request with
 * `asGoogleCloudHttpRequest`, push it in with `host.sendHttpAsync(...)`, and assert on the returned response
 * AND on egress through a faked client. No live Functions Framework server, no credentials.
 *
 * Consistency law: bar the `buildGoogleCloudFunctionHost` free-function form (see the README ledger) and the
 * `asGoogleCloudHttpRequest` builder name, lines 1/2/6 read identically to the AWS/Azure harness tests.
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { IBenzeneMessageSender } from '@benzene/clients';
import { benzeneTestHost, FakeBenzeneMessageSender, httpBuilder } from '@benzene/testing';
import {
  GoogleCloudFunctionApplicationBuilder,
  GoogleCloudFunctionStartUp,
  useHttp,
} from '@benzene/google-cloud-functions-http';
import {
  asGoogleCloudHttpRequest,
  buildGoogleCloudFunctionHost,
} from '@benzene/google-cloud-functions-http-testing';

const MessageTopics = {
  createOrder: 'order:create',
  placeOrder: 'order:place',
  orderCreated: 'order:created',
} as const;

class CreateOrder {
  name?: string;
}

class OrderCreatedEvent {
  id?: string;
  name?: string;
}

class OrderDto {
  id?: string;
  name?: string;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message(MessageTopics.createOrder, { registry, requestType: CreateOrder, responseType: OrderDto })
class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderDto> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderDto>> {
    return Promise.resolve(BenzeneResult.created<OrderDto>({ id: 'order-1', name: request.name }));
  }
}

@httpEndpoint('POST', '/orders/publish-created')
@message(MessageTopics.placeOrder, { registry, requestType: OrderCreatedEvent, responseType: OrderDto })
class PublishOrderCreatedHandler implements IMessageHandler<OrderCreatedEvent, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: OrderCreatedEvent): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(MessageTopics.orderCreated, request);
    return BenzeneResult.accepted<OrderDto>();
  }
}

/** The real sender the startup wires by default; throws if used, proving the `withServices` fake replaced it. */
class ThrowingMessageSender implements IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(): Promise<IBenzeneResultOf<TResponse>> {
    throw new Error('the real IBenzeneMessageSender was not overridden by the test fake');
  }
}

class GoogleCloudOrdersStartUp implements GoogleCloudFunctionStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: GoogleCloudFunctionApplicationBuilder): void {
    useHttp(app, (http) => useMessageHandlers(http, CreateOrderHandler, PublishOrderCreatedHandler));
  }
}

describe('benzeneTestHost — Google Cloud Functions (HTTP)', () => {
  it('creates an order via the HTTP trigger and returns 201 with the mapped body', async () => {
    const host = buildGoogleCloudFunctionHost(benzeneTestHost(GoogleCloudOrdersStartUp));

    const request = asGoogleCloudHttpRequest(httpBuilder('POST', '/orders', { name: 'acme' }));
    const response = await host.sendHttpAsync(request);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ name: 'acme' });
  });

  it('publishes on the order-created topic (ingress → handler → egress), asserting response AND egress', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = buildGoogleCloudFunctionHost(
      benzeneTestHost(GoogleCloudOrdersStartUp).withServices((services) =>
        services.addSingletonInstance(IBenzeneMessageSender, fake),
      ),
    );

    const orderCreated: OrderCreatedEvent = { id: 'abc', name: 'acme' };
    const request = asGoogleCloudHttpRequest(httpBuilder('POST', '/orders/publish-created', orderCreated));
    const response = await host.sendHttpAsync(request);

    expect(response.statusCode).toBe(202);
    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });
});
