/**
 * analytics-api's domain: a pure event consumer. Records revenue on `payment:captured` and a fulfilment
 * metric on `shipment:dispatched` — both Event Grid, shared with notifications (one event, many
 * subscriptions). Mirrors .NET's `Analytics/Domain.cs`.
 */
import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { selfHealthCheck } from '../wiring';

export class PaymentCaptured {
  orderId?: string;
  amount?: number;
  currency?: string;
}

export class ShipmentDispatched {
  orderId?: string;
  carrier?: string;
}

/** Records analytics receipts so a test can observe both Event Grid topics landed here. */
export const analyticsReceipts: string[] = [];

@message('payment:captured', { register: false, requestType: PaymentCaptured })
export class RecordPaymentCapturedHandler implements IMessageHandlerNoResponse<PaymentCaptured> {
  handleAsync(request: PaymentCaptured): Promise<void> {
    analyticsReceipts.push(`payment:captured:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

@message('shipment:dispatched', { register: false, requestType: ShipmentDispatched })
export class RecordShipmentDispatchedHandler implements IMessageHandlerNoResponse<ShipmentDispatched> {
  handleAsync(request: ShipmentDispatched): Promise<void> {
    analyticsReceipts.push(`shipment:dispatched:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

export const analyticsHandlers = [RecordPaymentCapturedHandler, RecordShipmentDispatchedHandler];
export const analyticsHealthChecks: IHealthCheck[] = [selfHealthCheck('analytics')];
