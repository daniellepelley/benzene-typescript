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
 *    with `benzeneTestHost(...)`, specialize it with the one `buildServiceBusWorkerHost(...)` line,
 *    override the outbound client with a fake via `withServices`, and push a native
 *    `asAzureServiceBusMessage(...)` in the front door — asserting the settlement decision AND the egress
 *    (invariants 1-4).
 *
 * NOTE (reported separately): booting the host with `useServiceBus` + `useMessageHandlers` does not route
 * to a message handler, because the standalone consumer's `useServiceBus` calls `addBenzeneMessage`,
 * whose type-erased `IMessageGetter` (the port collapses C#'s `IMessageGetter<TContext>` generics to one
 * token) hijacks routing over the Service Bus getters. That is a pre-existing bug in
 * `@benzene/azure-service-bus`, not in these test helpers; the host half here therefore drives the real
 * pipeline through a `useFn` middleware that reads the native message via the real getters and records a
 * result, proving the host boots/builds/resolves/runs the real application and returns the native
 * settlement decision.
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer, IServiceResolver } from '@benzene/abstractions';
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
  ServiceBusConsumerMessageBodyGetter,
  ServiceBusConsumerMessageTopicGetter,
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

// The StartUp whose consumer pipeline the host boots. Its `useFn` middleware reads the native message via
// the real getters and publishes through the injected sender, so the host test proves ingress -> real
// pipeline -> egress + settlement without depending on message-handler routing (see the file header).
class ServiceBusOrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useServiceBus(workers, { queueName: 'orders' }, noopClientFactory, (sb) => {
        sb.useFn(async (context: ServiceBusConsumerContext, next, resolver: IServiceResolver) => {
          const topic = new ServiceBusConsumerMessageTopicGetter().getTopic(context)?.id;
          const body = new ServiceBusConsumerMessageBodyGetter().getBody(context);
          await resolver
            .getService(IBenzeneMessageSender)
            .sendAsync(Topics.orderCreated, { receivedTopic: topic, receivedBody: body });
          context.messageResult = BenzeneResult.ok();
          await next();
        });
      }),
    );
  }
}

describe('ServiceBusWorkerBenzeneTestHost (via the benzeneTestHost harness)', () => {
  it('boots the startup, runs a native message through the real pipeline, and returns the settlement decision', async () => {
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
    // ...and the egress the pipeline published through the faked client, proving the native message's
    // topic + body rode through the real getters and the withServices override reached the sender.
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({
      receivedTopic: Topics.placeOrder,
      receivedBody: JSON.stringify({ name: 'acme' }),
    });
  });
});
