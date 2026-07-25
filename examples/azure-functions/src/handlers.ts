/**
 * The order domain, written ONCE - identical in shape to the AWS Lambda example's, to make the point
 * concrete: the same handler runs on Azure Functions and on AWS Lambda unchanged. It declares its topic
 * (and HTTP route) and knows nothing about the trigger that delivered the message.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

export const registry = new MessageHandlersRegistry();

/** Records the orders the warehouse consumer received, so tests can observe routing. */
export const warehouseNotifications: string[] = [];

/** `order:place` request. */
export class PlaceOrder {
  customerId?: string;
}

/** `order:place` response. */
export class OrderConfirmation {
  orderId?: string;
}

/** `order:placed` event payload. */
export class OrderPlaced {
  orderId?: string;
}

/** `order:placed` acknowledgement. */
export class WarehouseAck {
  accepted?: boolean;
}

/** Synchronous, request/response transport (HTTP). Placing an order returns a confirmation. */
@httpEndpoint('POST', '/orders')
@message('order:place', { registry, requestType: PlaceOrder, responseType: OrderConfirmation })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderConfirmation> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    const confirmation = new OrderConfirmation();
    confirmation.orderId = `order-${request.customerId ?? 'anon'}`;
    return Promise.resolve(BenzeneResult.created(confirmation));
  }
}

/** Event consumer hosted on the async transports (Service Bus, Event Hub). */
@message('order:placed', { registry, requestType: OrderPlaced, responseType: WarehouseAck })
export class NotifyWarehouseHandler implements IMessageHandler<OrderPlaced, WarehouseAck> {
  handleAsync(request: OrderPlaced): Promise<IBenzeneResultOf<WarehouseAck>> {
    warehouseNotifications.push(request.orderId ?? '<unknown>');
    const ack = new WarehouseAck();
    ack.accepted = true;
    return Promise.resolve(BenzeneResult.ok(ack));
  }
}
