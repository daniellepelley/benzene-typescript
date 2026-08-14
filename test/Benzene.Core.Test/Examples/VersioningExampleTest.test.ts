/**
 * Drives `@benzene-example/versioning` end-to-end over the BenzeneMessage front door, pushing envelope
 * requests whose version rides in the `benzene-version` header (never in the body). Ports the .NET
 * `HandlerVersionRoutingTests` (Mechanism A) and `CasterChainingTests` (Mechanism B): handler-version
 * dispatch picks the right handler per version, and payload casting up/down-casts a V1 producer through
 * the V1→V2→V3 chain (and back) around a single V3 handler.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageRequest } from '@benzenejs/core-messages';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  buildVersioningApp,
  InventoryAdjustmentV1,
  OrderAcceptedV1,
  OrderAcceptedV2,
  Topics,
} from '@benzene-example/versioning';

function request(topic: string, body: unknown, version?: string): BenzeneMessageRequest {
  const req = new BenzeneMessageRequest();
  req.topic = topic;
  req.headers = version ? { 'benzene-version': version } : {};
  req.body = JSON.stringify(body);
  return req;
}

describe('@benzene-example/versioning', () => {
  describe('Mechanism A — handler-version dispatch (order:create)', () => {
    it('routes a v1 request to the V1 handler', async () => {
      const { app, resolverFactory, log } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.orderCreate, { customerName: 'Jo', quantity: 3 }, 'v1'),
        resolverFactory,
      );

      expect(response.statusCode).toBe(BenzeneResultStatus.ok);
      expect((JSON.parse(response.body) as OrderAcceptedV1).handledBy).toBe('CreateOrderV1MessageHandler');
      expect(log.entries[0]).toContain('order:create v1');
    });

    it('routes a v2 request to the V2 handler', async () => {
      const { app, resolverFactory } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.orderCreate, { firstName: 'Jo', lastName: 'Bloggs', quantity: 3, currency: 'GBP' }, 'v2'),
        resolverFactory,
      );

      const accepted = JSON.parse(response.body) as OrderAcceptedV2;
      expect(accepted.handledBy).toBe('CreateOrderV2MessageHandler');
      expect(accepted.currency).toBe('GBP');
    });

    it('falls back to the highest version (V2) when no version is signalled', async () => {
      const { app, resolverFactory, log } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.orderCreate, { firstName: 'Jo', lastName: 'Bloggs', quantity: 1, currency: 'USD' }),
        resolverFactory,
      );

      expect((JSON.parse(response.body) as OrderAcceptedV2).handledBy).toBe('CreateOrderV2MessageHandler');
      expect(log.entries[0]).toContain('order:create v2');
    });
  });

  describe('Mechanism B — transparent casting with chaining (inventory:adjust)', () => {
    it('upcasts a V1 request V1→V2→V3 and downcasts the response V3→V2→V1', async () => {
      const { app, resolverFactory, log } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.inventoryAdjust, { sku: 'ABC', delta: 5 }, 'v1'),
        resolverFactory,
      );

      expect(response.statusCode).toBe(BenzeneResultStatus.ok);

      // The single V3 handler saw both chain-seeded fields — proof both hops of the upcast ran.
      expect(log.entries[0]).toContain('warehouse=wh-main');
      expect(log.entries[0]).toContain('reason=unspecified');

      const v1 = JSON.parse(response.body) as InventoryAdjustmentV1;
      // trace survives the downcast, carrying the chain-seeded values back to the V1 caller.
      expect(v1.trace).toBe('handled-on-v3;warehouse=wh-main;reason=unspecified');
      expect(v1.sku).toBe('ABC');
      // The response is V1-shaped: none of the KEYS the higher versions added leak through (the values
      // survive only inside `trace`, which every version has).
      expect(Object.keys(v1)).not.toContain('warehouseId');
      expect(Object.keys(v1)).not.toContain('reason');
    });

    it('single-hop: a V2 request upcasts V2→V3 and downcasts V3→V2 (keeps warehouseId, drops reason)', async () => {
      const { app, resolverFactory } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.inventoryAdjust, { sku: 'XYZ', delta: 2, warehouseId: 'wh-east' }, 'v2'),
        resolverFactory,
      );

      expect(response.body).toContain('wh-east'); // warehouseId survives to the V2 caller
      expect(response.body).not.toContain('"reason"'); // V3's added field is dropped on downcast
    });

    it('no-cast: a V3 request reaches the handler unchanged and keeps reason', async () => {
      const { app, resolverFactory } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.inventoryAdjust, { sku: 'Q', delta: 1, warehouseId: 'wh-w', reason: 'audit' }, 'v3'),
        resolverFactory,
      );

      expect(response.body).toContain('audit');
    });

    it('no-version: casting is bypassed entirely', async () => {
      const { app, resolverFactory } = buildVersioningApp();

      const response = await app.handleAsync(
        request(Topics.inventoryAdjust, { sku: 'N', delta: 9 }),
        resolverFactory,
      );

      expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    });
  });
});
