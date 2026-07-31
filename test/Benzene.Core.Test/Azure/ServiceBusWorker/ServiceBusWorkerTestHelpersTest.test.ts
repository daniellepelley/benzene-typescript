/**
 * Port-verification test for `@benzene/azure-service-bus-test-helpers` (ports
 * Benzene.Azure.ServiceBus.TestHelpers). Two complementary halves:
 *
 * 1. `asAzureServiceBusMessage` — faithful native-shape checks, plus a faithful port of the C#
 *    `ServiceBusConsumerRealPipelineTest`: drive the built message through the real
 *    `addBenzeneMessage`-free consumer DI graph (`addBenzene().addServiceBusConsumer()` +
 *    `useMessageHandlers()`) and a `ServiceBusConsumerApplication`, asserting the message routes to a
 *    decorated handler and the egress it published.
 * 2. `buildServiceBusWorkerHost` — dogfoods the ported startup-host harness: boot a real `BenzeneStartUp`
 *    that wires the full `useServiceBus(...)` + `useMessageHandlers(...)` pipeline, specialize it with the
 *    one `buildServiceBusWorkerHost(...)` line, override the outbound client with a fake via
 *    `withServices`, and push a native `asAzureServiceBusMessage(...)` in the front door — asserting the
 *    native message routes to the decorated handler, the settlement decision, AND the egress (invariants
 *    1-4). This exercises the real handler-routing path end to end (see the type-erasure fix in
 *    `addServiceBusConsumer`, README wrinkle 5, that lets `useServiceBus` + `useMessageHandlers` route).
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { IBenzeneMessageSender } from '@benzene/clients';
import { useWorker } from '@benzene/self-host';
import {
  addServiceBusConsumer,
  IServiceBusClientFactory,
  ServiceBusConsumerApplication,
  ServiceBusConsumerContext,
  useServiceBus,
} from '@benzene/azure-service-bus';
import {
  benzeneTestHost,
  FakeBenzeneMessageSender,
  messageBuilder,
  type BenzeneStartUp,
} from '@benzene/testing';
import { asAzureServiceBusMessage } from '@benzene/azure-service-bus-test-helpers';

const Topics = { placeOrder: 'order:place', orderCreated: 'order:created' } as const;

class PlaceOrder {
  name?: string;
}

class OrderDto {
  name?: string;
}

const registry = new MessageHandlersRegistry();

/** Publishes an `order:created` event through the injected sender, then reports success. */
@message(Topics.placeOrder, { registry, requestType: PlaceOrder, responseType: OrderDto })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(Topics.orderCreated, { name: request.name });
    return BenzeneResult.ok<OrderDto>({ name: request.name });
  }
}

/** The real outbound client the startup wires; throws if the fake did not replace it (invariant 3). */
class ThrowingMessageSender implements IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(): Promise<IBenzeneResultOf<TResponse>> {
    throw new Error('the real IBenzeneMessageSender was not overridden by the test fake');
  }
}

/** A client factory that must never be invoked — the test host runs no broker connection. */
const noopClientFactory: IServiceBusClientFactory = {
  create: () => {
    throw new Error('the Service Bus client should not be created by the test host');
  },
};

describe('asAzureServiceBusMessage', () => {
  it('carries the topic + headers as application properties and the serialized body', () => {
    const built = asAzureServiceBusMessage(
      messageBuilder(Topics.placeOrder, { name: 'acme' }).withHeader('tenant', 'acme-co'),
    );

    expect(built.applicationProperties?.['topic']).toBe(Topics.placeOrder);
    expect(built.applicationProperties?.['tenant']).toBe('acme-co');
    expect(built.body).toBe(JSON.stringify({ name: 'acme' }));
  });

  it('renders the body with a supplied serializer', () => {
    const built = asAzureServiceBusMessage(messageBuilder(Topics.placeOrder, { name: 'acme' }), {
      serialize: () => 'CUSTOM',
    });

    expect(built.body).toBe('CUSTOM');
  });

  // Faithful port of the C# ServiceBusConsumerRealPipelineTest: the built message routes through the real
  // message-handler pipeline to a decorated handler.
  it('routes through the real consumer pipeline to a decorated handler', async () => {
    const fake = new FakeBenzeneMessageSender();
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addServiceBusConsumer(container);
    container.addSingletonInstance(IBenzeneMessageSender, fake);

    const pipeline = new MiddlewarePipelineBuilder<ServiceBusConsumerContext>(container);
    useMessageHandlers(pipeline, PlaceOrderHandler);
    const application = new ServiceBusConsumerApplication(pipeline.build());

    const decision = await application.handleAsync(
      asAzureServiceBusMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
      container.createServiceResolverFactory(),
    );

    expect(decision.messageResult!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});

// The StartUp whose consumer pipeline the host boots: the full standalone-consumer wiring —
// `useServiceBus(...)` + `useMessageHandlers(...)` — so the host test proves ingress -> real
// message-handler routing -> handler -> egress + settlement through the front door.
class ServiceBusOrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useServiceBus(
        workers,
        { queueName: 'orders' },
        noopClientFactory,
        (sb) => {
          useMessageHandlers(sb, PlaceOrderHandler);
        },
        // Opt out of the auto-wired health check: this test asserts routing only, and its client
        // factory throws to prove no broker connection is made.
        false,
      ),
    );
  }
}

describe('ServiceBusWorkerBenzeneTestHost (via the benzeneTestHost harness)', () => {
  it('boots the startup, routes a native message to the handler, and returns the settlement decision', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(ServiceBusOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildServiceBusWorkerHost();

    const decision = await host.handleAsync(
      asAzureServiceBusMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
    );

    // The mapped settlement decision (native response out)...
    expect(decision.messageResult).toBeDefined();
    expect(decision.messageResult!.isSuccessful).toBe(true);
    // ...and the egress the handler published through the faked client, proving the native message
    // routed to PlaceOrderHandler (with its request mapped) and the withServices override reached the
    // sender.
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});
