/**
 * The order domain, written ONCE. The same handlers are hosted on five different AWS Lambda transports
 * (see `src/functions/`) - the point of Benzene: a handler declares its topic (and, for HTTP, its route)
 * and knows nothing about which transport delivered the message.
 *
 * Handlers register with a LOCAL registry (not the global one) so importing this example never pollutes
 * another module's handler discovery; each function passes the handler classes explicitly.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';

export const registry = new MessageHandlersRegistry();

/** Records the orders the warehouse consumer received, so tests (and the curious) can observe routing. */
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

/**
 * Synchronous, request/response transport (API Gateway HTTP). Placing an order returns a confirmation.
 */
@httpEndpoint('POST', '/orders')
@message('order:place', { registry, requestType: PlaceOrder, responseType: OrderConfirmation })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderConfirmation> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    const confirmation = new OrderConfirmation();
    confirmation.orderId = `order-${request.customerId ?? 'anon'}`;
    return Promise.resolve(BenzeneResult.created(confirmation));
  }
}

/**
 * Event consumer hosted on the async transports (SQS, SNS, EventBridge, Kafka). The transport differs;
 * the handler is identical.
 */
@message('order:placed', { registry, requestType: OrderPlaced, responseType: WarehouseAck })
export class NotifyWarehouseHandler implements IMessageHandler<OrderPlaced, WarehouseAck> {
  handleAsync(request: OrderPlaced): Promise<IBenzeneResultOf<WarehouseAck>> {
    warehouseNotifications.push(request.orderId ?? '<unknown>');
    const ack = new WarehouseAck();
    ack.accepted = true;
    return Promise.resolve(BenzeneResult.ok(ack));
  }
}
