/** Port of Benzene.Clients.HealthChecks.ContractHealthCheckExtensions. */
import { ServiceIdentifier } from '@benzene/abstractions';
import { addHealthCheckInstance, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { ClientHealthCheck } from './ClientHealthCheck';
import { IHasHealthCheck } from './IHasHealthCheck';

/**
 * Registration helpers for the consumer-side contract-drift check ({@link ClientHealthCheck}). Add these
 * to the CONTRACTS diagnostic topic via `useContractsCheck(...)` - never a liveness/readiness probe (see
 * {@link ClientHealthCheck}). C# extension methods -> free functions taking the builder first.
 *
 * C#'s generic `AddContractCheck<TClient>(builder, serviceName)` resolves `TClient` from DI; TypeScript
 * erases generics, so that overload becomes `addContractCheck` taking the client's `ServiceIdentifier`
 * explicitly, and the instance overload splits by name to `addContractCheckInstance`.
 */

/**
 * Registers a {@link ClientHealthCheck} for a downstream service, resolving its generated client from
 * DI (via `clientIdentifier`) each time checks run.
 */
export function addContractCheck(
  builder: IHealthCheckBuilder,
  serviceName: string,
  clientIdentifier: ServiceIdentifier<IHasHealthCheck>,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(
    (resolver) => new ClientHealthCheck(serviceName, resolver.getService(clientIdentifier)),
  );
}

/**
 * Registers a {@link ClientHealthCheck} for a downstream service against an explicit client instance
 * (rather than resolving one from DI).
 */
export function addContractCheckInstance(
  builder: IHealthCheckBuilder,
  serviceName: string,
  client: IHasHealthCheck,
): IHealthCheckBuilder {
  return addHealthCheckInstance(builder, new ClientHealthCheck(serviceName, client));
}
