/**
 * Payloads for the transparent-casting demo (Mechanism B — versioning.md §4).
 *
 * The topic `inventory:adjust` has THREE live payload versions of a single type family
 * (`InventoryAdjustment`) and ONE handler — written against the newest, V3. Producers on V1 or V2 are
 * transparently up-cast to V3 before the handler sees them, and the V3 response is down-cast back to the
 * caller's version on the way out. Only ADJACENT casters (V1⇄V2 and V2⇄V3) are declared; a V1 producer is
 * upcast by CHAINING V1→V2→V3 (and its response downcast V3→V2→V1) — there is deliberately no direct
 * V1⇄V3 caster.
 *
 * Each version adds one field. The up-caster seeds each newly-introduced field with a default (see
 * `startUp.ts`), which is how a plain V1 request/response can prove BOTH hops of the chain ran. `trace`
 * exists in every version, so a value the V3 handler writes there survives the downcast all the way back
 * to a V1 caller.
 */

export class InventoryAdjustmentV1 {
  sku?: string;
  delta = 0;
  trace?: string;
}

export class InventoryAdjustmentV2 {
  sku?: string;
  delta = 0;
  trace?: string;
  /** Introduced in V2. The V1→V2 up-caster seeds it with a default. */
  warehouseId?: string;
}

export class InventoryAdjustmentV3 {
  sku?: string;
  delta = 0;
  trace?: string;
  warehouseId?: string;
  /** Introduced in V3 — the version the handler is written against. The V2→V3 up-caster seeds it. */
  reason?: string;
}
