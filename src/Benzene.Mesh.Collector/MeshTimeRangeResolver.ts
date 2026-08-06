/**
 * Port of Benzene.Mesh.Collector.MeshTimeRangeResolver.
 *
 * Resolves a requested {@link MeshTimeRange} (Grafana relative grammar or ISO-8601 absolute) into a
 * concrete absolute `[from,to]` window against a supplied `now`, and helps read models build the
 * {@link MeshWindow} they report. A `undefined` range - or a range whose {@link MeshTimeRange.from} is
 * null/empty (no lower bound) - resolves to `undefined`: "unfiltered", today's behavior, so old clients
 * and the conformance fixtures are unaffected.
 *
 * The relative grammar mirrors Grafana's: `now`, and `now` followed by `-`/`+`, an integer, and a unit -
 * `s` seconds, `m` minutes, `h` hours, `d` days, `w` weeks, `M` months (~30d), `y` years (~365d). A
 * trailing `/unit` rounding suffix (e.g. `now-1d/d`) is accepted and ignored. Anything else is parsed as an
 * ISO-8601 absolute instant; an unparseable bound is treated as absent.
 *
 * Divergences from the C# original: `DateTimeOffset` -> epoch-millisecond `number` (so a resolved window
 * compares directly against `MeshTraceEvent.startedAt`); `System.Globalization` ISO parsing -> `Date.parse`
 * (the read models only ever feed it `Z`/offset-qualified ISO strings); the `"O"` round-trip format's 3
 * fractional-second digits match `Date.prototype.toISOString`.
 */
import { MeshTimeRange } from './Views';

/** A resolved absolute window, in epoch milliseconds. */
export interface ResolvedWindow {
  from: number;
  to: number;
}

const MillisPerSecond = 1000;
const MillisPerMinute = 60 * MillisPerSecond;
const MillisPerHour = 60 * MillisPerMinute;
const MillisPerDay = 24 * MillisPerHour;

export const MeshTimeRangeResolver = {
  /** Resolve the range to an absolute `[from,to]`, or `undefined` when it is absent/unfiltered. */
  resolve(range: MeshTimeRange | undefined, now: number): ResolvedWindow | undefined {
    if (range === undefined) {
      return undefined;
    }

    const from = parseBound(range.from, now);
    if (from === undefined) {
      // No lower bound => unfiltered (an upper bound alone doesn't make a window on these read models).
      return undefined;
    }

    const to = parseBound(range.to, now) ?? now;
    return { from, to };
  },

  /** Format an epoch-ms instant as the ISO-8601 UTC string the wire {@link MeshWindow} uses. */
  toIso(value: number): string {
    return new Date(value).toISOString();
  },
} as const;

function parseBound(value: string | undefined, now: number): number | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  value = value.trim();
  if (value.toLowerCase() === 'now') {
    return now;
  }

  if (value.toLowerCase().startsWith('now')) {
    let rest = value.substring(3);
    // Drop an optional rounding suffix (now-1d/d) - the read models don't need the rounding.
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      rest = rest.substring(0, slash);
    }

    if (rest.length === 0) {
      return now;
    }

    const sign = rest[0];
    if (sign !== '-' && sign !== '+') {
      return undefined;
    }

    const span = parseDuration(rest.substring(1));
    if (span === undefined) {
      return undefined;
    }

    return sign === '-' ? now - span : now + span;
  }

  const absolute = Date.parse(normalizeIsoToUtc(value));
  return Number.isNaN(absolute) ? undefined : absolute;
}

/**
 * Make a zone-less ISO **date-time** parse as UTC, matching the .NET resolver's
 * `DateTimeOffset.TryParse(AssumeUniversal | AdjustToUniversal)`. `Date.parse` reads a zone-less date-time
 * (`2026-07-24T10:00:00`) as host-**local**, so absent this it would drift by the deployment's UTC offset;
 * appending `Z` pins it to UTC on both planes. Date-only forms (`2026-07-24`) are already UTC in `Date.parse`
 * and zone-qualified forms (`…Z` / `…±hh:mm`) are left untouched; the relative `now±…` grammar never reaches here.
 */
function normalizeIsoToUtc(value: string): string {
  const trimmed = value.trim();
  return /T\d{2}:\d{2}/.test(trimmed) && !/(Z|[+-]\d{2}:?\d{2})$/.test(trimmed) ? `${trimmed}Z` : trimmed;
}

function parseDuration(s: string): number | undefined {
  if (s.length < 2) {
    return undefined;
  }

  const unit = s[s.length - 1];
  const digits = s.substring(0, s.length - 1);
  if (!/^-?\d+$/.test(digits)) {
    return undefined;
  }
  const n = Number(digits);

  // 'm' is minutes, 'M' is months - the case distinction is deliberate (Grafana's grammar).
  switch (unit) {
    case 's':
      return n * MillisPerSecond;
    case 'm':
      return n * MillisPerMinute;
    case 'h':
      return n * MillisPerHour;
    case 'd':
      return n * MillisPerDay;
    case 'w':
      return n * 7 * MillisPerDay;
    case 'M':
      return n * 30 * MillisPerDay;
    case 'y':
      return n * 365 * MillisPerDay;
    default:
      return undefined;
  }
}
