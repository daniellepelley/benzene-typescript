/**
 * Port of Benzene.Clients.HealthChecks - the consumer-side contract-drift health check: a
 * `ClientHealthCheck` probes a downstream provider via its generated client (`IHasHealthCheck`) and
 * reports reachability plus whether the provider's message contract has drifted from the one the client
 * was generated against (`ClientHealthCheckProcessor` annotates the verdict as a `ClientHashMatch`).
 * Register it on the contracts diagnostic topic via `addContractCheck`, never a liveness/readiness probe.
 */
export * from './IHasHealthCheck';
export * from './ClientHashMatch';
export * from './ClientHealthCheckProcessor';
export * from './ClientHealthCheck';
export * from './ContractHealthCheckExtensions';
