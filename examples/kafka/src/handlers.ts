/**
 * The order domain the Kafka consumer runs, written once and transport-agnostic. Kafka routes on the
 * literal record topic, so the `@message` topics are the Kafka topic names (`order_create`,
 * `order_delete`). The handlers register with a LOCAL registry; `startUp.ts` passes them explicitly.
 *
 * Ported from the shared order domain the .NET `Benzene.Examples.Kafka` consumer hosts.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler, IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { IOrderStore } from './orderStore';

export const registry = new MessageHandlersRegistry();

export const Topics = {
  orderCreate: 'order_create',
  orderDelete: 'order_delete',
} as const;

export class CreateOrderMessage {
  status = '';
  name = '';
}

export class OrderCreated {
  id = '';
}

export class DeleteOrderMessage {
  id = '';
}

/** Consumes `order_create` records and persists the order. */
@message(Topics.orderCreate, { registry, requestType: CreateOrderMessage, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrderMessage, OrderCreated> {
  static readonly inject = [IOrderStore] as const;
  constructor(private readonly store: IOrderStore) {}

  handleAsync(request: CreateOrderMessage): Promise<IBenzeneResultOf<OrderCreated>> {
    const id = `order-${this.store.orders.length + 1}`;
    this.store.add({ id, status: request.status, name: request.name });
    return Promise.resolve(BenzeneResult.created({ id }));
  }
}

/** Consumes `order_delete` records and removes the order (fire-and-forget — no response). */
@message(Topics.orderDelete, { registry, requestType: DeleteOrderMessage })
export class DeleteOrderHandler implements IMessageHandlerNoResponse<DeleteOrderMessage> {
  static readonly inject = [IOrderStore] as const;
  constructor(private readonly store: IOrderStore) {}

  handleAsync(request: DeleteOrderMessage): Promise<void> {
    this.store.remove(request.id);
    return Promise.resolve();
  }
}
