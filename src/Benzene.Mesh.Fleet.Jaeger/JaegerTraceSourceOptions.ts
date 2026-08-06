/** Port of Benzene.Mesh.Fleet.Jaeger.JaegerTraceSourceOptions. */

/** Default `correlationLookbackMs`: 24 hours, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultCorrelationLookbackMs = 24 * 60 * 60 * 1000;

/** Default `recentFlowsLookbackMs`: 1 hour, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultRecentFlowsLookbackMs = 60 * 60 * 1000;

/** Default Jaeger search `limit` per service call. */
export const DefaultSearchLimitPerService = 20;

/**
 * Where and over what windows {@link JaegerTraceSource} queries a Jaeger query service. A trace lookup is
 * by id (no window); Jaeger's search API needs a time range and - unlike Tempo/X-Ray - a *service*, so
 * correlation and recent-flows fan a bounded search out across services.
 *
 * `TimeSpan` -> millisecond `number` (`correlationLookbackMs`/`recentFlowsLookbackMs`). The C# `init`
 * properties -> plain mutable fields set after construction (`new JaegerTraceSourceOptions(url)` then assign),
 * since TypeScript object-initializer syntax has no `init`-only equivalent.
 */
export class JaegerTraceSourceOptions {
  /** Jaeger query's HTTP API base URL, e.g. `http://jaeger:16686` (trailing slash trimmed). */
  readonly jaegerUrl: string;

  /**
   * The services to fan a correlation / recent-flows search across. Jaeger's search API requires a
   * `service` parameter (there is no "all services" query), so a fleet-wide search must enumerate services.
   * When null/empty, the source discovers them via `GET /api/services` each time; set this to pin the set
   * (fewer calls, or to scope to the mesh's own services).
   */
  services?: readonly string[];

  /** How far back a `mesh:query:correlation` search scans Jaeger (ms). Default 24 hours. */
  correlationLookbackMs = DefaultCorrelationLookbackMs;

  /** How far back the fleet view's recent-flows search scans Jaeger (ms). Default 1 hour. */
  recentFlowsLookbackMs = DefaultRecentFlowsLookbackMs;

  /**
   * Jaeger search `limit` per service call - the max traces one service's search returns before the results
   * are merged and re-capped. Default 20.
   */
  searchLimitPerService = DefaultSearchLimitPerService;

  /**
   * Creates the options for a Jaeger query base URL (e.g. `http://jaeger:16686`).
   * @param jaegerUrl Jaeger query's HTTP base URL; a trailing slash is trimmed.
   */
  constructor(jaegerUrl: string) {
    this.jaegerUrl = jaegerUrl.replace(/\/+$/, '');
  }
}
