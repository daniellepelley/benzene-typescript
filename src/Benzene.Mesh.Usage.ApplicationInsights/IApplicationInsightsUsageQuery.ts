/** Port of Benzene.Mesh.Usage.ApplicationInsights.IApplicationInsightsUsageQuery (+ UsageCount). */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { ApplicationInsightsUsageOptions } from './ApplicationInsightsUsageOptions';

/**
 * One grouped usage count read from the metrics backend: the summed count at a (topic, transport, result)
 * combination. A thin, backend-agnostic row so `ApplicationInsightsUsageSource` is unit-testable without
 * constructing Azure SDK models. Any dimension the backend didn't carry is `undefined`. C# `record` ->
 * class with a positional constructor; `long` -> `number`.
 */
export class UsageCount {
  constructor(
    readonly topic: string | undefined,
    readonly transport: string | undefined,
    readonly result: string | undefined,
    readonly count: number,
  ) {}
}

/**
 * The query seam `ApplicationInsightsUsageSource` depends on: runs the grouped count-by-dimension query
 * against the metrics backend and returns plain `UsageCount` rows. The default implementation
 * (`LogsQueryUsageQuery`) issues KQL against a Log Analytics workspace; tests substitute a fake so the
 * source's mapping/window/degradation logic is covered without a live Azure dependency. `TimeSpan` -> ms
 * `number`; `CancellationToken` -> optional `AbortSignal`.
 */
export interface IApplicationInsightsUsageQuery {
  /** Runs the grouped count query over `windowMs` and returns one row per dimension combination. */
  queryAsync(
    options: ApplicationInsightsUsageOptions,
    windowMs: number,
    cancellationToken?: AbortSignal,
  ): Promise<UsageCount[]>;
}

/** Container token: the usage source resolves its query seam by this interface. */
export const IApplicationInsightsUsageQuery: ServiceToken<IApplicationInsightsUsageQuery> =
  serviceToken<IApplicationInsightsUsageQuery>('IApplicationInsightsUsageQuery');
