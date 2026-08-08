/**
 * The order domain, written once and transport-agnostic. Each handler declares its Benzene `@message`
 * topic AND its HTTP route with `@httpEndpoint`; the Google Cloud Functions HTTP host routes an inbound
 * request to the matching handler. Ported from the shared order domain the .NET `Benzene.Examples.Google`
 * hosts on HTTP. The handlers register with a LOCAL registry; `startUp.ts` passes them explicitly.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';
import { IOrderStore } from './orderStore';

export const registry = new MessageHandlersRegistry();

export const Topics = {
  orderCreate: 'order:create',
  orderList: 'order:list',
} as const;

export class CreateOrder {
  name?: string;
}

export class OrderDto {
  id?: string;
  name?: string;
}

export class ListOrders {}

export class OrderList {
  orders: OrderDto[] = [];
}

/** `POST /orders` — create an order and return the confirmation (201). */
@httpEndpoint('POST', '/orders')
@message(Topics.orderCreate, { registry, requestType: CreateOrder, responseType: OrderDto })
export class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderDto> {
  static readonly inject = [IOrderStore] as const;
  constructor(private readonly store: IOrderStore) {}

  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderDto>> {
    const order = { id: `order-${this.store.orders.length + 1}`, name: request.name ?? '' };
    this.store.add(order);
    return Promise.resolve(BenzeneResult.created<OrderDto>(order));
  }
}

/** `GET /orders` — list every order created so far. */
@httpEndpoint('GET', '/orders')
@message(Topics.orderList, { registry, requestType: ListOrders, responseType: OrderList })
export class ListOrdersHandler implements IMessageHandler<ListOrders, OrderList> {
  static readonly inject = [IOrderStore] as const;
  constructor(private readonly store: IOrderStore) {}

  handleAsync(): Promise<IBenzeneResultOf<OrderList>> {
    const list = new OrderList();
    list.orders = this.store.orders.map((o) => ({ id: o.id, name: o.name }));
    return Promise.resolve(BenzeneResult.ok(list));
  }
}
