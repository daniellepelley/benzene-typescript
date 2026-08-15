/**
 * The three domain handlers — one per deployed service (orders/payments/shipping), selected at startup
 * by the `MESH_SERVICE` env var (see `serviceApp.ts`). Only the selected domain's handler is registered,
 * so each service exposes its own domain topic (and the mesh's aggregated topic catalog shows real
 * cross-service ownership) — the TypeScript port of .NET K8sMesh's `Service/Domain.cs`.
 *
 * The services also CHAIN to each other over HTTP: orders -> payments -> shipping, each hop carried as a
 * lightweight BenzeneMessage envelope POSTed to the next service's `/benzene-message` endpoint via
 * `HttpBenzeneMessageClient` (`serviceApp.ts` wires it from the `DOWNSTREAM_MSG_URL` env var). This turns
 * the mesh from a discovery-only demo into one with real service-to-service traffic to observe.
 *
 * Deliberately simplified from .NET's K8sMesh: the payload-versioning demonstration on the
 * `payment:take` hop (a v1 producer upcast to a single v2 handler, docs/specification/versioning.md) is
 * not reproduced here — it is an orthogonal feature of the spec, not needed to prove the Kubernetes
 * discovery + service-to-service chaining story this example exists for, and keeping it out keeps the
 * example's surface area matched to what `examples/aws-lambda-mesh`'s own domain handlers do (see the
 * task report).
 */
import { randomUUID } from 'node:crypto';
import { Constructor, IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneMessageClient, sendMessageAsync } from '@benzenejs/clients';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';

/** Maps a service name to the domain handler type this service exposes. */
export function handlersFor(service: string): Constructor<unknown>[] {
  switch (service) {
    case 'payments':
      return [TakePaymentHandler];
    case 'shipping':
      return [BookShipmentHandler];
    default:
      return [CreateOrderHandler];
  }
}

function shortId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

// ---------------------------------------------------------------------------------------------------
// orders — order:create, chains to payments' payment:take
// ---------------------------------------------------------------------------------------------------

export class CreateOrderRequest {
  customerId = '';
  sku = '';
  quantity = 0;
}

export class OrderCreated {
  orderId = '';
  status = '';
}

@httpEndpoint('POST', '/orders')
@message('order:create', { requestType: CreateOrderRequest, responseType: OrderCreated })
export class CreateOrderHandler implements IMessageHandler<CreateOrderRequest, OrderCreated> {
  static readonly inject = [IBenzeneMessageClient] as const;

  constructor(private readonly downstream: IBenzeneMessageClient) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<OrderCreated>> {
    const orderId = shortId('order');

    // Chain the next hop over HTTP: ask the payments service to take payment, addressed by its
    // in-cluster Kubernetes DNS name (DOWNSTREAM_MSG_URL). Best-effort — HttpBenzeneMessageClient never
    // throws on a downstream failure; the order is still recorded as created.
    const payment: TakePaymentRequest = { orderId, amount: request.quantity * 10 };
    const result = await sendMessageAsync<TakePaymentRequest, PaymentTaken>(
      this.downstream,
      'payment:take',
      payment,
    );
    console.log(`order ${orderId} created; payment:take -> ${result.status}`);

    return BenzeneResult.created<OrderCreated>({ orderId, status: 'created' });
  }
}

// ---------------------------------------------------------------------------------------------------
// payments — payment:take, chains to shipping's shipment:book
// ---------------------------------------------------------------------------------------------------

export class TakePaymentRequest {
  orderId = '';
  amount = 0;
}

export class PaymentTaken {
  paymentId = '';
  status = '';
}

@httpEndpoint('POST', '/payments')
@message('payment:take', { requestType: TakePaymentRequest, responseType: PaymentTaken })
export class TakePaymentHandler implements IMessageHandler<TakePaymentRequest, PaymentTaken> {
  static readonly inject = [IBenzeneMessageClient] as const;

  constructor(private readonly downstream: IBenzeneMessageClient) {}

  async handleAsync(request: TakePaymentRequest): Promise<IBenzeneResultOf<PaymentTaken>> {
    const paymentId = shortId('pay');
    console.log(`payment ${paymentId} captured for order ${request.orderId}`);

    // Second hop: once captured, ask the shipping service to book the shipment.
    const shipment: BookShipmentRequest = { orderId: request.orderId, address: '123 Example St', carrier: 'royal-mail' };
    const result = await sendMessageAsync<BookShipmentRequest, ShipmentBooked>(
      this.downstream,
      'shipment:book',
      shipment,
    );
    console.log(`shipment:book -> ${result.status}`);

    return BenzeneResult.created<PaymentTaken>({ paymentId, status: 'captured' });
  }
}

// ---------------------------------------------------------------------------------------------------
// shipping — shipment:book, terminal (no downstream)
// ---------------------------------------------------------------------------------------------------

export class BookShipmentRequest {
  orderId = '';
  address = '';
  carrier = '';
}

export class ShipmentBooked {
  shipmentId = '';
  status = '';
}

@httpEndpoint('POST', '/shipments')
@message('shipment:book', { requestType: BookShipmentRequest, responseType: ShipmentBooked })
export class BookShipmentHandler implements IMessageHandler<BookShipmentRequest, ShipmentBooked> {
  // Terminal service — books the shipment and returns; no further downstream, no client is injected.
  handleAsync(request: BookShipmentRequest): Promise<IBenzeneResultOf<ShipmentBooked>> {
    const shipmentId = shortId('ship');
    console.log(`shipment ${shipmentId} booked for order ${request.orderId} via ${request.carrier}`);
    return Promise.resolve(BenzeneResult.created<ShipmentBooked>({ shipmentId, status: 'booked' }));
  }
}
