/** Port of Benzene.Mesh.Fleet.Tempo.TempoTraceSourceOptions. */

/** Default `correlationLookbackMs`: 24 hours, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultCorrelationLookbackMs = 24 * 60 * 60 * 1000;

/** Default `recentFlowsLookbackMs`: 1 hour, in milliseconds (`TimeSpan` -> millisecond `number`). */
export const DefaultRecentFlowsLookbackMs = 60 * 60 * 1000;

/**
 * Where and over what windows {@link TempoTraceSource} queries Grafana Tempo's trace API. A trace lookup is
 * by id (no window); Tempo's search API (`GET /api/search`) needs a time range, so correlation and
 * recent-flows scan a bounded window.
 *
 * `TimeSpan` -> millisecond `number` (`correlationLookbackMs`/`recentFlowsLookbackMs`). The C# `init`
 * properties -> plain mutable fields set after construction (`new TempoTraceSourceOptions(url)` then assign),
 * since TypeScript object-initializer syntax has no `init`-only equivalent.
 */
export class TempoTraceSourceOptions {
  /** Tempo's HTTP API base URL (the query-frontend), e.g. `http://tempo:3200` (trailing slash trimmed). */
  readonly tempoUrl: string;

  /**
   * How far back a `benzene:mesh:query:correlation` search scans Tempo (ms). Default 24 hours - a business
   * correlation id (a ticket/log id) is typically chased soon after the event.
   */
  correlationLookbackMs = DefaultCorrelationLookbackMs;

  /**
   * How far back the fleet view's recent-flows search scans Tempo (ms). Default 1 hour - the fleet view
   * wants the latest activity, a shorter horizon than a correlation chase.
   */
  recentFlowsLookbackMs = DefaultRecentFlowsLookbackMs;

  /**
   * Creates the options for a Tempo base URL (e.g. `http://tempo:3200`).
   * @param tempoUrl Tempo's HTTP API base URL; a trailing slash is trimmed.
   */
  constructor(tempoUrl: string) {
    this.tempoUrl = tempoUrl.replace(/\/+$/, '');
  }
}
