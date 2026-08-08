/** Topic ids and payload-version names used across the example. Port of the .NET `Topics`/`Versions`. */

export const Topics = {
  orderCreate: 'order:create',
  inventoryAdjust: 'inventory:adjust',
} as const;

/**
 * The payload schema version names. They are ordinary strings on the wire (the `benzene-version`
 * header/attribute); the framework compares them ordinally when picking a handler, so `v1 < v2 < v3`.
 */
export const Versions = {
  v1: 'v1',
  v2: 'v2',
  v3: 'v3',
} as const;
