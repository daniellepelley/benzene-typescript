/**
 * The order service's message handlers. Each is decorated with `@message` (its topic) and `@httpEndpoint`
 * (its HTTP verb + route), exactly as a real Benzene service declares them - the registry is the single
 * source of truth the mesh `benzene:spec` descriptor is derived from ("derived from running code, never declared").
 *
 * They register with a LOCAL `MessageHandlersRegistry` (not the global one), so importing this example
 * never pollutes another module's handler discovery.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';

/** The handler registry this service self-describes from. */
export const registry = new MessageHandlersRegistry();

// Payloads are classes, not interfaces: the runtime recovers the erased request type from its
// constructor (topic/schema/validation keying), which an interface can't provide. Fields use the
// idiomatic optional `?:` form.

/** `order:create` request payload. */
export class CreateOrder {
  customerId?: string;
}

/** `order:create` response payload. */
export class OrderCreated {
  orderId?: string;
}

/** `order:get` request/response payload. */
export class Order {
  orderId?: string;
  status?: string;
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
