/**
 * notifications-api's domain: a pure event consumer. Notifies on `order:placed` (Event Hub, fanned out
 * alongside inventory), `payment:captured` and `shipment:dispatched` (both Event Grid). Mirrors .NET's
 * `Notifications/Domain.cs`.
 */
import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { selfHealthCheck } from '../wiring';

export class OrderPlaced {
  orderId?: string;
  sku?: string;
}

export class PaymentCaptured {
  orderId?: string;
  amount?: number;
  currency?: string;
}

export class ShipmentDispatched {
  orderId?: string;
  carrier?: string;
}

/** Records notification receipts so a test can observe every fan-out topic landed here. */
export const notificationsReceipts: string[] = [];

@message('order:placed', { register: false, requestType: OrderPlaced })
export class NotifyOnOrderPlacedHandler implements IMessageHandlerNoResponse<OrderPlaced> {
  handleAsync(request: OrderPlaced): Promise<void> {
    notificationsReceipts.push(`order:placed:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

@message('payment:captured', { register: false, requestType: PaymentCaptured })
export class NotifyOnPaymentCapturedHandler implements IMessageHandlerNoResponse<PaymentCaptured> {
  handleAsync(request: PaymentCaptured): Promise<void> {
    notificationsReceipts.push(`payment:captured:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

@message('shipment:dispatched', { register: false, requestType: ShipmentDispatched })
export class NotifyOnShipmentDispatchedHandler implements IMessageHandlerNoResponse<ShipmentDispatched> {
  handleAsync(request: ShipmentDispatched): Promise<void> {
    notificationsReceipts.push(`shipment:dispatched:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

export const notificationsHandlers = [
  NotifyOnOrderPlacedHandler,
  NotifyOnPaymentCapturedHandler,
  NotifyOnShipmentDispatchedHandler,
];
export const notificationsHealthChecks: IHealthCheck[] = [selfHealthCheck('notifications')];
