/**
 * inventory-api's domain: a pure event consumer. Reserves stock on `order:placed` (Event Hub, its own
 * consumer group) and decrements stock on `shipment:dispatched` (Event Grid). Mirrors .NET's
 * `Inventory/Domain.cs`.
 */
import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { selfHealthCheck } from '../wiring';

export class OrderPlaced {
  orderId?: string;
  sku?: string;
  quantity?: number;
}

export class ShipmentDispatched {
  orderId?: string;
  shipmentId?: string;
}

/** Records reserved-stock receipts so a test can observe the Event Hub fan-out landed here. */
export const inventoryReceipts: string[] = [];

@message('order:placed', { register: false, requestType: OrderPlaced })
export class ReserveStockHandler implements IMessageHandlerNoResponse<OrderPlaced> {
  handleAsync(request: OrderPlaced): Promise<void> {
    inventoryReceipts.push(`order:placed:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

@message('shipment:dispatched', { register: false, requestType: ShipmentDispatched })
export class DecrementStockHandler implements IMessageHandlerNoResponse<ShipmentDispatched> {
  handleAsync(request: ShipmentDispatched): Promise<void> {
    inventoryReceipts.push(`shipment:dispatched:${request.orderId ?? '?'}`);
    return Promise.resolve();
  }
}

export const inventoryHandlers = [ReserveStockHandler, DecrementStockHandler];
export const inventoryHealthChecks: IHealthCheck[] = [selfHealthCheck('inventory')];
