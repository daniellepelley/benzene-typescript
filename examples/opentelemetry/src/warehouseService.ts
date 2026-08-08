/**
 * A downstream collaborator the order handler depends on, injected via the container. Each method opens
 * its own child span on the example's tracer, so an `order_create` trace shows `Warehouse.ReserveStock`
 * and `Warehouse.Dispatch` nested under the handler span. Port of the .NET `WarehouseService`.
 */
import { serviceToken } from '@benzene/abstractions';
import { withSpan } from './exampleDiagnostics';

export interface IWarehouseService {
  dispatchAsync(productId: string, quantity: number): Promise<string>;
}

export const IWarehouseService = serviceToken<IWarehouseService>('IWarehouseService');

export class WarehouseService implements IWarehouseService {
  async dispatchAsync(productId: string, quantity: number): Promise<string> {
    await withSpan('Warehouse.ReserveStock', async (span) => {
      span.setAttribute('order.product_id', productId);
      span.setAttribute('order.quantity', quantity);
    });

    return withSpan('Warehouse.Dispatch', async (span) => {
      const trackingId = Math.random().toString(16).slice(2, 10);
      span.setAttribute('order.tracking_id', trackingId);
      return trackingId;
    });
  }
}
