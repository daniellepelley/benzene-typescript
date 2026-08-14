/**
 * A plain Benzene HTTP order domain — the Node/Express analog of the .NET `Benzene.Example.Asp`. Each
 * handler declares its HTTP route with `@httpEndpoint` alongside its `@message` topic and knows nothing
 * about Express; `@benzenejs/express` routes the request. `register: false` — the handlers record their
 * metadata but join no registry; `orderService.ts` passes them to `useMessageHandlers` explicitly.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IOrderStore } from './orderStore';

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
@message('order:create', { register: false, requestType: CreateOrder, responseType: OrderDto })
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
@message('order:list', { register: false, requestType: ListOrders, responseType: OrderList })
export class ListOrdersHandler implements IMessageHandler<ListOrders, OrderList> {
  static readonly inject = [IOrderStore] as const;
  constructor(private readonly store: IOrderStore) {}

  handleAsync(): Promise<IBenzeneResultOf<OrderList>> {
    const orders = this.store.orders.map((o) => ({ id: o.id, name: o.name }));
    return Promise.resolve(BenzeneResult.ok<OrderList>({ orders }));
  }
}
