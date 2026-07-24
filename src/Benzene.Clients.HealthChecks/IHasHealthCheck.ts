/** Port of Benzene.Clients.HealthChecks.IHasHealthCheck. */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { HealthCheckResponse } from '@benzene/health-checks-core';

/**
 * Implemented by a generated downstream-service client: exposes the contract hash the client was
 * generated against and a health call that returns the provider's (drift-annotated) health response.
 */
export interface IHasHealthCheck {
  /** The contract hash this client was generated against. */
  readonly hashCode: string;

  /** Calls the downstream service's health endpoint, returning its aggregated health response. */
  healthCheckAsync(): Promise<IBenzeneResultOf<HealthCheckResponse>>;
}
