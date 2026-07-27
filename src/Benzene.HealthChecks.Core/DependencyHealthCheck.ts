/** Port of Benzene.HealthChecks.Core.DependencyHealthCheck. */
import { IDependencyHealthCheck } from './IDependencyHealthCheck';
import { IHealthCheck } from './IHealthCheck';
import { IHealthCheckResult } from './IHealthCheckResult';

/**
 * Adapts a plain `IHealthCheck` into the dependency registration category (`IDependencyHealthCheck`)
 * so the general (`healthcheck`) probe harvests it while liveness/readiness/contracts ignore it (see
 * `IDependencyHealthCheck` for why a dependency check must stay off the Kubernetes probes). Concrete
 * client checks (`SqsHealthCheck`, …) stay plain `IHealthCheck` implementations; the auto-wiring
 * registers `addScopedFactory(IDependencyHealthCheck, r => new DependencyHealthCheck(build(r), dedupKey))`.
 * The check's `tags`/`ttl`/`timeout` overrides are delegated through unchanged.
 *
 * **The category is non-critical by default** (`isNonCritical` is forced `true`): an unreachable
 * dependency *degrades* the deep `healthcheck` report to a warning rather than flipping the aggregate
 * unhealthy. That layer is a monitoring surface, not a probe, so a downstream blip must not turn the
 * endpoint into a 503 — the per-dependency warning is still visible to monitoring / the mesh. A caller
 * who wants a dependency to be fatal registers an explicit critical check instead.
 */
export class DependencyHealthCheck implements IDependencyHealthCheck {
  readonly dedupKey: string;

  /**
   * @param inner The dependency check to run under the dependency category.
   * @param dedupKey A stable de-duplication key (auto-wiring sets it to the dependency's `(kind, name)`).
   * When omitted, falls back to the inner check's `type`.
   */
  constructor(
    private readonly inner: IHealthCheck,
    dedupKey?: string,
  ) {
    this.dedupKey = dedupKey ?? inner.type;
  }

  get type(): string {
    return this.inner.type;
  }

  get tags(): string[] | undefined {
    return this.inner.tags;
  }

  /**
   * Always `true`: a dependency-category check is non-critical, so a failure degrades the deep
   * `healthcheck` report to a warning rather than flipping the aggregate unhealthy. This overrides the
   * inner check's value — the category, not the individual check, decides.
   */
  get isNonCritical(): boolean {
    return true;
  }

  get ttl(): number | undefined {
    return this.inner.ttl;
  }

  get timeout(): number | undefined {
    return this.inner.timeout;
  }

  executeAsync(): Promise<IHealthCheckResult> {
    return this.inner.executeAsync();
  }
}
