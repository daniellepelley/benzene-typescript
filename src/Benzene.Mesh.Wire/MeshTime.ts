/**
 * The mesh wire's timestamps (`startedAt`, `sentAt`, `firstSeen`, `lastSeen`) are ISO-8601 strings, as the spec's
 * shapes show them (mesh.md §3-§5) and as the .NET (`DateTimeOffset`) and Go (`time.Time`) ports read and write
 * them. This port keeps them as epoch milliseconds in memory (the port of C# `DateTimeOffset`), so it converts at
 * the wire: {@link MeshTime.toWire} on the way out, and {@link MeshTime.fromWire} on the way in - which also
 * accepts a number, so a peer (or an older version of this port) that sent epoch milliseconds still ingests.
 */
export const MeshTime = {
  /** Epoch milliseconds → the ISO-8601 wire form. */
  toWire(epochMs: number): string {
    return new Date(epochMs).toISOString();
  },

  /**
   * A wire timestamp → epoch milliseconds: an ISO-8601 string or a number; anything unparseable is `fallback`
   * (never a throw - no feed fails ingestion, mesh.md §6).
   */
  fromWire(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? fallback : parsed;
    }
    return fallback;
  },
} as const;
