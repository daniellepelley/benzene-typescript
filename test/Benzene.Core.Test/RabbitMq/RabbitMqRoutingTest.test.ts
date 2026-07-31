import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { IBenzeneMessageSender } from '@benzene/clients';
import { useWorker, WorkerApplicationBuilder } from '@benzene/self-host';
import {
  IRabbitMqConnectionFactory,
  RabbitMqApplication,
  RabbitMqContext,
  useRabbitMq,
} from '@benzene/rabbitmq';
import { FakeBenzeneMessageSender, messageBuilder } from '@benzene/testing';
import { asRabbitMqBenzeneMessage } from '@benzene/rabbitmq-test-helpers';

/**
 * Regression test for the type-erasure routing fix: booting the full `useRabbitMq(...)` +
 * `useMessageHandlers(...)` wiring must route a native delivery to the decorated handler. Before the
 * fix, `useRabbitMq` registered `addBenzeneMessage`, whose `BenzeneMessageGetter` won the erased
 * `IMessageGetter` token and hijacked routing over the RabbitMq getters. Drives the real
 * `RabbitMqApplication` the wiring registers, without a broker.
 */

const Topics = { placeOrder: 'order:place', orderCreated: 'order:created' } as const;
const registry = new MessageHandlersRegistry();

class PlaceOrder {
  name?: string;
}
class OrderDto {
  name?: string;
}

@message(Topics.placeOrder, { registry, requestType: PlaceOrder, responseType: OrderDto })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];
  constructor(private readonly sender: IBenzeneMessageSender) {}
  async handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(Topics.orderCreated, { name: request.name });
    return BenzeneResult.ok<OrderDto>({ name: request.name });
  }
}

const noopConnectionFactory: IRabbitMqConnectionFactory = {
  createConnectionAsync: () => {
    throw new Error('the RabbitMq connection should not be created by this test');
  },
};

describe('useRabbitMq + useMessageHandlers routing', () => {
  it('routes a native delivery to the decorated handler through the real RabbitMqApplication', async () => {
    const fake = new FakeBenzeneMessageSender();
    const container = new DefaultBenzeneServiceContainer();
    container.addSingletonInstance(IBenzeneMessageSender, fake);

    const app: IBenzeneApplicationBuilder = new WorkerApplicationBuilder(container);
    useWorker(app, (workers) =>
      useRabbitMq(workers, { queueName: 'orders' }, noopConnectionFactory, (rabbit) => {
        useMessageHandlers(rabbit, PlaceOrderHandler);
      }),
    );

    const resolverFactory = container.createServiceResolverFactory();
    const application = resolverFactory.createScope().getService(RabbitMqApplication) as RabbitMqApplication;

    const result = await application.handleAsync(
      asRabbitMqBenzeneMessage(messageBuilder(Topics.placeOrder, { name: 'acme' })),
      resolverFactory,
    );

    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(true);
    expect(fake.lastTopic).toBe(Topics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ name: 'acme' });
  });
});
