/** Port of Benzene.Mesh.Fleet.Aws.XRay.XRayTraceSourceOptions. */

/** Default `correlationLookbackMs`: 24 hours, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultCorrelationLookbackMs = 24 * 60 * 60 * 1000;

/** Default `recentFlowsLookbackMs`: 1 hour, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultRecentFlowsLookbackMs = 60 * 60 * 1000;

/** Default `recentFlowsServiceEnrichmentMax`: the fleet cap (20 rows). */
export const DefaultRecentFlowsServiceEnrichmentMax = 20;

/**
 * Tuning for {@link XRayTraceSource}. Only correlation search and recent-flows enrichment need these - a
 * trace lookup is by id (`BatchGetTraces`, no window). X-Ray's `GetTraceSummaries` requires a time range, so
 * a correlation/recent-flows lookup searches a bounded window for matching traces.
 *
 * `TimeSpan` -> millisecond `number` (`correlationLookbackMs`/`recentFlowsLookbackMs`). The C# `init`
 * properties -> plain mutable fields set after construction (`new XRayTraceSourceOptions()` then assign),
 * since TypeScript object-initializer syntax has no `init`-only equivalent. Unlike the Tempo/Jaeger options
 * there is no endpoint URL: the X-Ray SDK client resolves region/credentials from the ambient AWS
 * environment, so the source takes the client, not a URL.
 */
export class XRayTraceSourceOptions {
  /**
   * How far back a `benzene:mesh:query:correlation` search scans X-Ray for matching traces (ms). Default 24 hours -
   * a business correlation id (a ticket/log id) is typically chased soon after the event, and X-Ray retains
   * traces for 30 days so a longer window is available if you widen it.
   */
  correlationLookbackMs = DefaultCorrelationLookbackMs;

  /**
   * How far back the fleet view's recent-flows list scans X-Ray (ms). Default 1 hour - the fleet view wants
   * the latest activity, not history; kept separate from {@link correlationLookbackMs} because "what's
   * flowing now" is a much shorter horizon than "find the trace(s) for this ticket".
   */
  recentFlowsLookbackMs = DefaultRecentFlowsLookbackMs;

  /**
   * How many of the recent-flows rows to enrich with real span data via a bounded `BatchGetTraces` (X-Ray
   * allows 5 ids/call, so 20 -> <=4 calls). Enrichment reads the pipeline-stamped `benzene.service` as each
   * row's service names (instead of X-Ray's own `ServiceIds`, which on Lambda are infra/handler names like
   * `ApiGatewayLambdaHandler`), the mapped events' real millisecond start time (instead of the
   * second-granularity trace-id epoch), and the real span count. Default 20 (= the fleet cap); a row whose
   * trace can't be fetched or that carries no Benzene span falls back to the summary plane per-row. Set to
   * `0` to opt out entirely (pure-summary behavior: `ServiceIds` names, id-epoch ordering, `events = 0`).
   */
  recentFlowsServiceEnrichmentMax = DefaultRecentFlowsServiceEnrichmentMax;
}
