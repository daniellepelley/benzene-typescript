/** Port of Benzene.HealthChecks.Core.DependencyHealthCheckExtensions. */
import { IBenzeneServiceContainer, IServiceResolver } from '@benzene/abstractions';
import { DependencyHealthCheck } from './DependencyHealthCheck';
import { IDependencyHealthCheck } from './IDependencyHealthCheck';
import { IHealthCheck } from './IHealthCheck';

/**
 * The config-time registration seam that auto-wired client extensions call to contribute an
 * external-dependency reachability check to the **dependency** category. Registering under
 * `IDependencyHealthCheck` (rather than plain `IHealthCheck`) is what keeps the check on the deep
 * `healthcheck` layer and off the liveness/readiness/contracts probes (see `IDependencyHealthCheck`
 * for the cascading-failure reasoning).
 *
 * Lives in `@benzene/health-checks-core` — not the middleware package — so a client package can
 * auto-wire using only its existing lightweight core reference, without pulling in the full
 * health-check middleware.
 *
 * @param services The service container to register on.
 * @param factory Builds the underlying check per request against the current `IServiceResolver` —
 * reuse the client's own SDK handle here.
 * @param dedupKey A stable de-dup key; when omitted, falls back to the built check's `type`.
 * @returns The service container, for chaining.
 */
export function addDependencyHealthCheck(
  services: IBenzeneServiceContainer,
  factory: (resolver: IServiceResolver) => IHealthCheck,
  dedupKey?: string,
): IBenzeneServiceContainer {
  return services.addScopedFactory(
    IDependencyHealthCheck,
    (resolver) => new DependencyHealthCheck(factory(resolver), dedupKey),
  );
}
