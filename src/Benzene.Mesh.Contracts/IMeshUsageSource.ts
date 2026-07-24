/** Port of Benzene.Mesh.Contracts.IMeshUsageSource. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { MeshUsage } from './MeshUsage';

/**
 * Supplies a `MeshUsage` report for the aggregator to publish as `usage.json` - a port, not an
 * implementation, so a usage adapter depends on this package alone. Returning `undefined` means "nothing to
 * report this run" (distinct from an empty `entries` array, which means "wired, no traffic observed").
 * `CancellationToken` -> optional `AbortSignal`; `Task<MeshUsage?>` -> `Promise<MeshUsage | undefined>`.
 */
export interface IMeshUsageSource {
  /** Fetches the current usage report, or `undefined` when this source has nothing to report. */
  fetchUsageAsync(cancellationToken?: AbortSignal): Promise<MeshUsage | undefined>;
}

/** Container token: usage sources are registered and collected via `getServices(IMeshUsageSource)`. */
export const IMeshUsageSource: ServiceToken<IMeshUsageSource> =
  serviceToken<IMeshUsageSource>('IMeshUsageSource');
