/**
 * Port-verification test for `@benzenejs/azure-event-hub-test-helpers` (ports
 * Benzene.Azure.EventHub.TestHelpers). Two complementary halves:
 *
 * 1. `asEventHubBenzeneMessage` — faithful native-shape checks, plus a faithful port of the C#
 *    `EventHubConsumerRealPipelineTest`: drive the built event through the real consumer DI graph
 *    (`addBenzene().addEventHubConsumer()` + `useMessageHandlers()`) and an `EventHubConsumerApplication`,
 *    asserting the event routes to a decorated handler and the egress it published.
 * 2. `buildEventHubWorkerHost` — dogfoods the ported startup-host harness: boot a real `BenzeneStartUp`
 *    that wires the full `useEventHub(...)` + `useMessageHandlers(...)` pipeline, specialize it with the
 *    one `buildEventHubWorkerHost(...)` line, override the outbound client with a fake via `withServices`,
 *    and push a native `asEventHubBenzeneMessage(...)` in the front door — asserting the native event
 *    routes to the decorated handler, the recorded result, AND the egress. This exercises the real
 *    handler-routing path end to end (see the type-erasure fix in `addEventHubConsumer`, README wrinkle 5).
 */
import { describe, expect, it } from 'vitest';
import type { EventHubConsumerClient } from '@azure/event-hubs';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { useWorker } from '@benzenejs/self-host';
import {
  addEventHubConsumer,
  EventHubConsumerApplication,
  EventHubConsumerContext,
  IEventProcessorClientFactory,
  useEventHub,
} from '@benzenejs/azure-event-hub';
import {
  benzeneTestHost,
  FakeBenzeneMessageSender,
  messageBuilder,
  type BenzeneStartUp,
} from '@benzenejs/testing';
import { asEventHubBenzeneMessage } from '@benzenejs/azure-event-hub-test-helpers';

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

/** A client factory that must never be invoked — the test host runs no hub connection. */
const noopClientFactory: IEventProcessorClientFactory = {
  create: (): EventHubConsumerClient => {
    throw new Error('the Event Hub client should not be created by the test host');
  },
};

describe('asEventHubBenzeneMessage', () => {
  it('carries the topic + headers as event properties and the serialized body', () => {
    const built = asEventHubBenzeneMessage(
      messageBuilder(Topics.placeOrder, { name: 'acme' }).withHeader('tenant', 'acme-co'),
    );

    expect(built.properties?.['topic']).toBe(Topics.placeOrder);
    expect(built.properties?.['tenant']).toBe('acme-co');
    expect(built.body).toBe(JSON.stringify({ name: 'acme' }));
  });

  it('renders the body with a supplied serializer', () => {
    const built = asEventHubBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' }), {
      serialize: () => 'CUSTOM',
    });

    expect(built.body).toBe('CUSTOM');
  });

  // Faithful port of the C# EventHubConsumerRealPipelineTest: the built event routes through the real
  // message-handler pipeline to a decorated handler.
  it('routes through the real consumer pipeline to a decorated handler', async () => {
    const fake = new FakeBenzeneMessageSender();
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventHubConsumer(container);
    container.addSingletonInstance(IBenzeneMessageSender, fake);

    const pipeline = new MiddlewarePipelineBuilder<EventHubConsumerContext>(container);
    useMessageHandlers(pipeline, PlaceOrderHandler);
    const application = new EventHubConsumerApplication(pipeline.build());

    const result = await application.handleAsync(
      asEventHubBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
      container.createServiceResolverFactory(),
    );

    expect(result!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});

// The StartUp whose consumer pipeline the host boots: the full standalone-consumer wiring —
// `useEventHub(...)` + `useMessageHandlers(...)` — so the host test proves ingress -> real
// message-handler routing -> handler -> egress + result through the front door.
class EventHubOrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useEventHub(workers, {}, noopClientFactory, (eh) => {
        useMessageHandlers(eh, PlaceOrderHandler);
      }),
    );
  }
}

describe('EventHubWorkerBenzeneTestHost (via the benzeneTestHost harness)', () => {
  it('boots the startup, routes a native event to the handler, and returns the recorded result', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(EventHubOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildEventHubWorkerHost();

    const result = await host.handleAsync(
      asEventHubBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
    );

    // The recorded result (native response out)...
    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(true);
    // ...and the egress the handler published through the faked client, proving the native event routed
    // to PlaceOrderHandler (with its request mapped) and the withServices override reached the sender.
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});
