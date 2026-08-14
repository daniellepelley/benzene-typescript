/**
 * The versioning demo's handlers, written once. `register: false` — they record their metadata but join
 * no registry; `startUp.ts` passes them to `useMessageHandlers` explicitly, so importing this example
 * never pollutes another module's handler discovery.
 *
 * Mechanism A (handler-version dispatch): `order:create` has two handlers, one per version — the incoming
 * `benzene-version` picks which runs, and a producer that sends NO version gets the highest (v2).
 * Mechanism B (transparent casting): `inventory:adjust` has ONE handler, on V3 — older producers are cast
 * to V3 before it runs (see `startUp.ts`), so it only ever sees its own schema.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import {
  CreateOrderV1,
  CreateOrderV2,
  OrderAcceptedV1,
  OrderAcceptedV2,
} from './contracts/order';
import { InventoryAdjustmentV3 } from './contracts/inventory';
import { IProcessedLog } from './services/processedLog';
import { Topics, Versions } from './topics';

/**
 * Mechanism A — the V1 implementation of `order:create`. Registered for version `v1`; the router runs it
 * only when the incoming `benzene-version` is `v1`. Shares the topic with the V2 handler — two genuinely
 * different request shapes, two handlers, no casting between them.
 */
@message(Topics.orderCreate, {
  register: false,
  version: Versions.v1,
  requestType: CreateOrderV1,
  responseType: OrderAcceptedV1,
})
export class CreateOrderV1MessageHandler implements IMessageHandler<CreateOrderV1, OrderAcceptedV1> {
  static readonly inject = [IProcessedLog] as const;
  constructor(private readonly log: IProcessedLog) {}

  handleAsync(request: CreateOrderV1): Promise<IBenzeneResultOf<OrderAcceptedV1>> {
    this.log.record(`order:create v1 | customer=${request.customerName} qty=${request.quantity}`);
    return Promise.resolve(
      BenzeneResult.ok<OrderAcceptedV1>({
        orderId: 'order-1',
        handledBy: 'CreateOrderV1MessageHandler',
      }),
    );
  }
}

/**
 * Mechanism A — the V2 implementation of `order:create`. Registered for version `v2`. Because `v2` is the
 * highest registered version, it is also the one the `VersionSelector` falls back to when a producer
 * sends no version at all — i.e. V2 is the topic's default handler.
 */
@message(Topics.orderCreate, {
  register: false,
  version: Versions.v2,
  requestType: CreateOrderV2,
  responseType: OrderAcceptedV2,
})
export class CreateOrderV2MessageHandler implements IMessageHandler<CreateOrderV2, OrderAcceptedV2> {
  static readonly inject = [IProcessedLog] as const;
  constructor(private readonly log: IProcessedLog) {}

  handleAsync(request: CreateOrderV2): Promise<IBenzeneResultOf<OrderAcceptedV2>> {
    this.log.record(
      `order:create v2 | customer=${request.firstName} ${request.lastName} qty=${request.quantity} currency=${request.currency}`,
    );
    return Promise.resolve(
      BenzeneResult.ok<OrderAcceptedV2>({
        orderId: 'order-1',
        handledBy: 'CreateOrderV2MessageHandler',
        currency: request.currency,
      }),
    );
  }
}

/**
 * Mechanism B — the ONE handler for `inventory:adjust`, written against the newest schema, V3. It is
 * UNVERSIONED (`@message(topic)` with no version) because the version axis is handled by the casting
 * pipeline, not by picking a handler: a V1 or V2 producer is up-cast to V3 (V1 by chaining V1→V2→V3)
 * before this method runs, so it only ever sees V3.
 *
 * It never references V1/V2 or any caster. To make the round trip observable it writes the two
 * chain-seeded fields (`warehouseId` from the V1→V2 hop, `reason` from the V2→V3 hop) into `trace`, which
 * exists in every version and therefore survives the response downcast back to the caller's version.
 */
@message(Topics.inventoryAdjust, {
  register: false,
  requestType: InventoryAdjustmentV3,
  responseType: InventoryAdjustmentV3,
})
export class AdjustInventoryMessageHandler
  implements IMessageHandler<InventoryAdjustmentV3, InventoryAdjustmentV3>
{
  static readonly inject = [IProcessedLog] as const;
  constructor(private readonly log: IProcessedLog) {}

  handleAsync(request: InventoryAdjustmentV3): Promise<IBenzeneResultOf<InventoryAdjustmentV3>> {
    this.log.record(
      `inventory:adjust v3 | sku=${request.sku} delta=${request.delta} warehouse=${request.warehouseId} reason=${request.reason}`,
    );
    return Promise.resolve(
      BenzeneResult.ok<InventoryAdjustmentV3>({
        sku: request.sku,
        delta: request.delta,
        warehouseId: request.warehouseId,
        reason: request.reason,
        // Stamped by the (only) V3 handler; carries the chain-seeded values back out so even a V1 caller —
        // whose response is downcast to V1 — can see that both hops of the upcast ran.
        trace: `handled-on-v3;warehouse=${request.warehouseId};reason=${request.reason}`,
      }),
    );
  }
}
