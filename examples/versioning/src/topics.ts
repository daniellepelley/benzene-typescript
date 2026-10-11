/** Topic ids and payload-version names used across the example. Port of the .NET `Topics`/`Versions`. */

export const Topics = {
  orderCreate: 'order:create',
  inventoryAdjust: 'inventory:adjust',
} as const;

/**
 * The payload schema version names. They are ordinary strings on the wire (the `benzene-version`
 * header/attribute), matched exactly when picking a handler.
 */
export const Versions = {
  v1: 'v1',
  v2: 'v2',
  v3: 'v3',
} as const;
