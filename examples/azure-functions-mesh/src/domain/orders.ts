/**
 * orders-api's domain: places an order over HTTP, then sends `payment:take` (Service Bus command) and
 * `order:placed` (Event Hub fan-out event). Mirrors .NET's `Orders/Domain.cs`.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { selfHealthCheck } from '../wiring';

export class CreateOrderRequest {
  customerId?: string;
  sku?: string;
  quantity?: number;
}

export class OrderCreated {
  orderId?: string;
  status?: string;
}

/** The command orders-api sends to payments-api over a Service Bus queue (`payment:take`). */
export class OutboundTakePayment {
  orderId?: string;
  amount?: number;
  currency?: string;
}

/** The event orders-api streams to Event Hub (`order:placed`), fanned out to inventory + notifications. */
export class OutboundOrderPlaced {
  orderId?: string;
  sku?: string;
  quantity?: number;
  amount?: number;
}

/** Places an order, then commands payments-api to take payment (Service Bus) and streams order:placed (Event Hub). */
@httpEndpoint('POST', '/orders')
@message('order:create', { register: false, requestType: CreateOrderRequest, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, OrderCreated> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<OrderCreated>> {
    const order = new OrderCreated();
    order.orderId = `order-${request.sku ?? 'unknown'}`;
    order.status = 'created';

    const amount = (request.quantity ?? 1) * 10;

    // Point-to-point command over Service Bus: payments-api must take this exactly once. Best-effort —
    // with no ServiceBusConnection configured (e.g. a local run) the send fails and is swallowed here,
    // matching .NET's own per-send try/catch; the order is still created either way.
    try {
      const takePayment = new OutboundTakePayment();
      takePayment.orderId = order.orderId;
      takePayment.amount = amount;
      takePayment.currency = 'GBP';
      await this.sender.sendAsync('payment:take', takePayment);
    } catch {
      // best-effort downstream send — see the comment above.
    }

    // Fan-out event over Event Hub: every consumer group (inventory, notifications) reads it. Also
    // best-effort.
    try {
      const orderPlaced = new OutboundOrderPlaced();
      orderPlaced.orderId = order.orderId;
      orderPlaced.sku = request.sku;
      orderPlaced.quantity = request.quantity;
      orderPlaced.amount = amount;
      await this.sender.sendAsync('order:placed', orderPlaced);
    } catch {
      // best-effort downstream send — see the comment above.
    }

    return BenzeneResult.created(order);
  }
}

export const ordersHandlers = [CreateOrderHandler];
export const ordersHealthChecks: IHealthCheck[] = [selfHealthCheck('orders')];
