/**
 * Port-verification test for `@benzenejs/kafka-core-test-helpers` (ports Benzene.Kafka.Core.TestHelpers).
 * Two complementary halves:
 *
 * 1. `asKafkaBenzeneMessage` — faithful native-shape checks (literal record topic, headers, serialized
 *    `value` body).
 * 2. `buildKafkaWorkerHost` — dogfoods the ported startup-host harness: boot a real `BenzeneStartUp` that
 *    wires the full `useKafka(...)` + `useMessageHandlers(...)` pipeline, specialize it with the one
 *    `buildKafkaWorkerHost(...)` line, override the outbound client with a fake via `withServices`, and
 *    push a native `asKafkaBenzeneMessage(...)` in the front door — asserting the native record routes to
 *    the decorated handler, the handler's result, AND the egress. This exercises the real handler-routing
 *    path end to end (see the type-erasure fix in `useKafka`, which wires `addBenzene` rather than
 *    `addBenzeneMessage` so `useKafka` + `useMessageHandlers` route).
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { useWorker } from '@benzenejs/self-host';
import { IKafkaConsumerFactory, useKafka } from '@benzenejs/kafka-core';
import {
  benzeneTestHost,
  FakeBenzeneMessageSender,
  messageBuilder,
  type BenzeneStartUp,
} from '@benzenejs/testing';
import { asKafkaBenzeneMessage } from '@benzenejs/kafka-core-test-helpers';

// Kafka routes on the literal record topic — the builder topic must be the Kafka topic name.
const Topics = { placeOrder: 'order-place', orderCreated: 'order-created' } as const;

class PlaceOrder {
  name?: string;
}

class OrderDto {
  name?: string;
}

const registry = new MessageHandlersRegistry();

/** Publishes an `order-created` event through the injected sender, then reports success. */
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

/** A consumer factory that must never be invoked — the test host runs no broker connection. */
const noopConsumerFactory: IKafkaConsumerFactory = {
  create: () => {
    throw new Error('the Kafka consumer should not be created by the test host');
  },
};

describe('asKafkaBenzeneMessage', () => {
  it('carries the literal record topic, the headers, and the serialized value body', () => {
    const built = asKafkaBenzeneMessage(
      messageBuilder(Topics.placeOrder, { name: 'acme' }).withHeader('tenant', 'acme-co'),
    );

    expect(built.topic).toBe(Topics.placeOrder);
    expect((built.message.headers?.['tenant'] as Buffer).toString('utf8')).toBe('acme-co');
    expect((built.message.value as Buffer).toString('utf8')).toBe(JSON.stringify({ name: 'acme' }));
  });

  it('renders the body with a supplied serializer', () => {
    const built = asKafkaBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' }), {
      serialize: () => 'CUSTOM',
    });

    expect((built.message.value as Buffer).toString('utf8')).toBe('CUSTOM');
  });
});

// The StartUp whose consumer pipeline the host boots: the full standalone-consumer wiring —
// `useKafka(...)` + `useMessageHandlers(...)`. No admin factory is supplied, so no health check wires
// (the routing path is what this test asserts).
class KafkaOrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
    services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useWorker(app, (workers) =>
      useKafka(workers, { topics: [Topics.placeOrder] }, noopConsumerFactory, (kafka) => {
        useMessageHandlers(kafka, PlaceOrderHandler);
      }),
    );
  }
}

describe('KafkaBenzeneTestHost (via the benzeneTestHost harness)', () => {
  it('boots the startup, routes a native record to the handler, and returns the handler result', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(KafkaOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildKafkaWorkerHost();

    const result = await host.handleAsync(
      asKafkaBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
    );

    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});
