/**
 * Port-verification test for `@benzenejs/rabbitmq-test-helpers` (ports Benzene.RabbitMq.TestHelpers). Two
 * complementary halves:
 *
 * 1. `asRabbitMqBenzeneMessage` — faithful native-shape checks (topic header, extra headers, routing-key
 *    fallback carrier, serialized `content` body).
 * 2. `buildRabbitMqWorkerHost` — dogfoods the ported startup-host harness: boot a real `BenzeneStartUp`
 *    that wires the full `useRabbitMq(...)` + `useMessageHandlers(...)` pipeline, specialize it with the
 *    one `buildRabbitMqWorkerHost(...)` line, override the outbound client with a fake via `withServices`,
 *    and push a native `asRabbitMqBenzeneMessage(...)` in the front door — asserting the native delivery
 *    routes to the decorated handler, the handler's result, AND the egress. This exercises the real
 *    handler-routing path end to end (see the type-erasure fix in `useRabbitMq`, which wires `addBenzene`
 *    rather than `addBenzeneMessage` so `useRabbitMq` + `useMessageHandlers` route).
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { useWorker } from '@benzenejs/self-host';
import { IRabbitMqConnectionFactory, useRabbitMq } from '@benzenejs/rabbitmq';
import {
  benzeneTestHost,
  FakeBenzeneMessageSender,
  messageBuilder,
  type BenzeneStartUp,
} from '@benzenejs/testing';
import { asRabbitMqBenzeneMessage } from '@benzenejs/rabbitmq-test-helpers';

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

/** The real outbound client the startup wires; throws if the fake did not replace it. */
class ThrowingMessageSender implements IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(): Promise<IBenzeneResultOf<TResponse>> {
    throw new Error('the real IBenzeneMessageSender was not overridden by the test fake');
  }
}

/** A connection factory that must never be invoked — the test host runs no broker connection. */
const noopConnectionFactory: IRabbitMqConnectionFactory = {
  createConnectionAsync: () => {
    throw new Error('the RabbitMq connection should not be created by the test host');
  },
};

describe('asRabbitMqBenzeneMessage', () => {
  it('carries the topic header, the extra headers, the routing key, and the serialized content body', () => {
    const built = asRabbitMqBenzeneMessage(
      messageBuilder(Topics.placeOrder, { name: 'acme' }).withHeader('tenant', 'acme-co'),
    );

    expect(built.properties.headers?.['topic']).toBe(Topics.placeOrder);
    expect(built.properties.headers?.['tenant']).toBe('acme-co');
    expect(built.fields.routingKey).toBe(Topics.placeOrder);
    expect(built.content.toString('utf8')).toBe(JSON.stringify({ name: 'acme' }));
  });

  it('renders the body with a supplied serializer', () => {
    const built = asRabbitMqBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' }), {
      serialize: () => 'CUSTOM',
    });

    expect(built.content.toString('utf8')).toBe('CUSTOM');
  });
});

// The StartUp whose consumer pipeline the host boots: the full standalone-consumer wiring —
// `useRabbitMq(...)` + `useMessageHandlers(...)`.
class RabbitMqOrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useRabbitMq(
        workers,
        { queueName: 'orders' },
        noopConnectionFactory,
        (rabbit) => {
          useMessageHandlers(rabbit, PlaceOrderHandler);
        },
        // Opt out of the auto-wired health check: this test asserts routing only, and its connection
        // factory throws to prove no broker connection is made.
        false,
      ),
    );
  }
}

describe('RabbitMqBenzeneTestHost (via the benzeneTestHost harness)', () => {
  it('boots the startup, routes a native delivery to the handler, and returns the handler result', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(RabbitMqOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildRabbitMqWorkerHost();

    const result = await host.handleAsync(
      asRabbitMqBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
    );

    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});
