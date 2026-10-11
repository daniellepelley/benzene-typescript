/** Port of Benzene.HealthChecks.Schema.SchemaHealthCheck. */
import { IServiceResolver } from '@benzenejs/abstractions';
import {
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
  SchemaHealthCheckConstants,
} from '@benzenejs/health-checks-core';
import { SpecBuilder, SpecCache, SpecRequest } from '@benzenejs/schema-openapi';

/**
 * A provider-side contract health check: it publishes the `contractHash` of the Contract Document this
 * service serves on `benzene:spec` (contract-document.md §6.1), so a consumer's
 * `@benzenejs/clients-health-checks` drift check can compare it with the hash its generated client embeds.
 *
 * The check does not hash anything itself: it reads the **served** document's `contractHash` — the same
 * document, built by the same `SpecBuilder` (through the `SpecCache` when `useSpec` registered one), that
 * `benzene:spec` answers with. A default generated client embeds the `contractHash` of that same document,
 * so the two compare like with like (contract-document.md §6.4).
 *
 * PORTING NOTES: C#'s check rebuilt a hash per call from the handlers alone (no events, no application
 * info) with a private HMAC, which never matched what a client generated from the served document embeds;
 * the design ruling (Phase 3a, §10.2.8) replaces it, in every port, with the served value.
 */
export class SchemaHealthCheck implements IHealthCheck {
  /** @param resolver Resolves the spec feeds (handlers, outbound declarations, schema sources). */
  constructor(private readonly resolver: IServiceResolver) {}

  get type(): string {
    return SchemaHealthCheckConstants.type;
  }

  executeAsync(): Promise<IHealthCheckResult> {
    const request = new SpecRequest('benzene', 'json');
    const build = (r: SpecRequest): string => new SpecBuilder().createSpec(this.resolver, r);
    const cache = this.resolver.tryGetService(SpecCache);
    const json = cache !== undefined ? cache.getOrBuild(request, build) : build(request);
    const hashCode = (JSON.parse(json) as { contractHash?: string }).contractHash;

    const data: Record<string, unknown> = { [SchemaHealthCheckConstants.hashCodeKey]: hashCode };

    return Promise.resolve(HealthCheckResult.createInstance(true, SchemaHealthCheckConstants.type, data));
  }
}
