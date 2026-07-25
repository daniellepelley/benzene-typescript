/**
 * The order service's message handlers. Each is decorated with `@message` (its topic) and `@httpEndpoint`
 * (its HTTP verb + route), exactly as a real Benzene service declares them - the registry is the single
 * source of truth the mesh `spec` descriptor is derived from ("derived from running code, never declared").
 *
 * They register with a LOCAL `MessageHandlersRegistry` (not the global one), so importing this example
 * never pollutes another module's handler discovery.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

/** The handler registry this service self-describes from. */
export const registry = new MessageHandlersRegistry();

/** `order:create` request payload. */
export class CreateOrder {
  customerId: string | undefined;
}

/** `order:create` response payload. */
export class OrderCreated {
  orderId: string | undefined;
}

/** `order:get` request/response payload. */
export class Order {
  orderId: string | undefined;
  status: string | undefined;
}

@httpEndpoint('POST', '/orders')
@message('order:create', { registry, requestType: CreateOrder, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderCreated> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.orderId = `order-${request.customerId ?? 'anon'}`;
    return Promise.resolve(BenzeneResult.created(payload));
  }
}

@httpEndpoint('GET', '/orders/{orderId}')
@message('order:get', { registry, requestType: Order, responseType: Order })
export class GetOrderHandler implements IMessageHandler<Order, Order> {
  handleAsync(): Promise<IBenzeneResultOf<Order>> {
    const payload = new Order();
    payload.orderId = 'demo';
    payload.status = 'shipped';
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}
