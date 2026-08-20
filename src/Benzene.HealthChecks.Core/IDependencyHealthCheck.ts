/** Port of Benzene.HealthChecks.Core.IDependencyHealthCheck. */
import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IHealthCheck } from './IHealthCheck';

/**
 * An `IHealthCheck` registered under the **dependency** category: an external-dependency reachability
 * check (a queue, a downstream service, a database) that auto-wired clients contribute.
 *
 * This is a **DI-registration category, not a context marker** — the concrete checks stay plain
 * `IHealthCheck` implementations; the auto-wiring registers them *as* `IDependencyHealthCheck`
 * (typically wrapped by `DependencyHealthCheck`).
 *
 * **These belong on the deep `benzene:healthcheck` layer, not on a Kubernetes probe.** A dependency check is
 * *shared-fate*: every replica runs the same check against the same downstream, so a transient blip
 * fails all of them at once. Wiring that into liveness would restart-storm the fleet; wiring it into
 * readiness would pull every pod from the Service's endpoints at once — the classic cascading-failure
 * anti-pattern. So the general (`benzene:healthcheck`) probe harvests these for monitoring / the mesh
 * inventory / humans, while liveness, readiness and contracts do not. A developer who has reasoned
 * that a specific dependency is genuinely safe to gate traffic on can still add it to readiness
 * explicitly; auto-wiring never does it for them.
 */
export interface IDependencyHealthCheck extends IHealthCheck {
  /**
   * A stable key used to de-duplicate dependency checks so two registrations of the same dependency
   * (e.g. two `useSns(sameArn)` calls) collapse to a single check. Auto-wiring sets this to the
   * dependency's `(kind, name)`. Optional; the finder falls back to the check's `type` when absent
   * (matching the C# default interface member `DedupKey => Type`).
   */
  readonly dedupKey?: string;
}

/**
 * Container token for `IDependencyHealthCheck`. Resolved as a set via
 * `resolver.getServices(IDependencyHealthCheck)`, kept disjoint from the plain `IHealthCheck` token so
 * a liveness/readiness probe (which resolves only `IHealthCheck`) never harvests a dependency check.
 */
export const IDependencyHealthCheck: ServiceToken<IDependencyHealthCheck> =
  serviceToken<IDependencyHealthCheck>('IDependencyHealthCheck');
