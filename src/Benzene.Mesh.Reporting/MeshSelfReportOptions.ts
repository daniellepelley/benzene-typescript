/** Port of Benzene.Mesh.Reporting.MeshSelfReportOptions. */
import { HealthCheckResponse } from '@benzene/health-checks-core';

/** Default minimum interval between opportunistic publishes: 5 minutes, in milliseconds. */
export const DefaultMinimumIntervalMs = 5 * 60 * 1000;

/**
 * Configures `MeshSelfReportMiddleware` - how to name this service, how to obtain its own current
 * spec/health on demand, and how often that's allowed to happen. The spec/health providers are delegates
 * (a self-reporting service already knows how to produce both), keeping this package free of a dependency
 * on the spec/health generators.
 *
 * `Func<Task<string?>>`/`Func<Task<HealthCheckResponse?>>` -> `() => Promise<... | undefined>`; `TimeSpan`
 * -> millisecond `number`.
 */
export class MeshSelfReportOptions {
  readonly minimumIntervalMs: number;

  /**
   * @param serviceName This service's name (matches its registry entry's `name`).
   * @param specProvider Produces this service's current spec document, verbatim, or `undefined` if unavailable.
   * @param healthProvider Produces this service's current aggregated health response, or `undefined` if unavailable.
   * @param minimumIntervalMs Minimum time between opportunistic publishes (ms). Defaults to 5 minutes.
   */
  constructor(
    readonly serviceName: string,
    readonly specProvider: () => Promise<string | undefined>,
    readonly healthProvider: () => Promise<HealthCheckResponse | undefined>,
    minimumIntervalMs: number = DefaultMinimumIntervalMs,
  ) {
    this.minimumIntervalMs = minimumIntervalMs;
  }
}
