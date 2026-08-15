/**
 * shipping-api's domain: consumes `shipment:book` (Service Bus queue, and HTTP for direct calls), then
 * publishes `shipment:dispatched` (Event Grid) — the terminal integration event of the flow. Mirrors
 * .NET's `Shipping/Domain.cs`.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { selfHealthCheck } from '../wiring';

export class BookShipmentRequest {
  orderId?: string;
  carrier?: string;
}

export class ShipmentBooked {
  shipmentId?: string;
  status?: string;
}

/** The terminal integration event shipping-api publishes to Event Grid (`shipment:dispatched`). */
export class OutboundShipmentDispatched {
  orderId?: string;
  shipmentId?: string;
  carrier?: string;
}

/** Books a shipment (arriving over Service Bus or HTTP), then publishes shipment:dispatched to Event Grid. */
@httpEndpoint('POST', '/shipments')
@message('shipment:book', { register: false, requestType: BookShipmentRequest, responseType: ShipmentBooked })
export class BookShipmentHandler implements IMessageHandler<BookShipmentRequest, ShipmentBooked> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: BookShipmentRequest): Promise<IBenzeneResultOf<ShipmentBooked>> {
    const shipment = new ShipmentBooked();
    shipment.shipmentId = `ship-${request.orderId ?? 'unknown'}`;
    shipment.status = 'booked';

    // Best-effort (see orders' CreateOrderHandler for why): a missing EventGridEndpoint/EventGridKey
    // fails the send, caught here, without failing the request.
    try {
      const dispatched = new OutboundShipmentDispatched();
      dispatched.orderId = request.orderId;
      dispatched.shipmentId = shipment.shipmentId;
      dispatched.carrier = request.carrier;
      await this.sender.sendAsync('shipment:dispatched', dispatched);
    } catch {
      // best-effort downstream send.
    }

    return BenzeneResult.created(shipment);
  }
}

export const shippingHandlers = [BookShipmentHandler];
export const shippingHealthChecks: IHealthCheck[] = [selfHealthCheck('shipping')];
