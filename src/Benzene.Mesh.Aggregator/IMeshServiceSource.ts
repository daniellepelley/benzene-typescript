/** Port of Benzene.Mesh.Aggregator.IMeshServiceSource. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { MeshServiceRegistryEntry } from '@benzene/mesh-contracts';

/**
 * Fetches a registered service's spec and health documents however fits that service's
 * `MeshServiceRegistryEntry.source` - HTTP (`HttpMeshServiceSource`, the only implementation this package
 * ships), an AWS Lambda Invoke, or any other transport an adapter package chooses to add. `MeshAggregator`
 * is decoupled from any one transport by depending on this port rather than a `fetch`/`HttpClient` directly.
 *
 * `CancellationToken` -> optional `AbortSignal`. C#'s default-interface-method `TryFetchSpecAsync` (returns
 * a completed `null` task) has no TS interface default; sources that don't override it are handled by the
 * aggregator treating a missing method as "not supported" - so it is declared optional here.
 */
export interface IMeshServiceSource {
  /**
   * The `MeshServiceRegistryEntry.source` value this source answers for (see `MeshServiceSource`).
   * Matched case-insensitively.
   */
  readonly key: string;

  /**
   * Fetches `entry`'s spec document, verbatim, as raw JSON text. Should throw on failure (connection
   * error, timeout, non-success response) rather than returning nothing - `MeshAggregator` catches and
   * records the exception's type name.
   */
  fetchSpecAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string>;

  /**
   * Fetches `entry`'s health check response, verbatim, as raw JSON text (to be deserialized by the
   * caller). Should throw only on a genuine fetch failure - an unhealthy-but-successfully-fetched response
   * (e.g. HTTP 503 with a valid body) must still be returned, not treated as a failure, so it can be
   * distinguished from a truly unreachable service.
   */
  fetchHealthAsync(entry: MeshServiceRegistryEntry, cancellationToken?: AbortSignal): Promise<string>;

  /**
   * Fetches `entry`'s spec in an alternate representation (e.g. `"asyncapi"` - the same `spec` endpoint's
   * other `type`), or `undefined` when this source can't serve that type. Best-effort and additive: unlike
   * {@link fetchSpecAsync} (whose failure marks the service unreachable), a source that doesn't support
   * alternate spec types just returns `undefined` and the aggregator omits that service from whatever
   * artifact is built on it. Optional (C#'s default interface method returned `null`), so existing sources
   * don't have to implement it.
   */
  tryFetchSpecAsync?(
    entry: MeshServiceRegistryEntry,
    specType: string,
    cancellationToken?: AbortSignal,
  ): Promise<string | undefined>;
}

/** Container token: sources are registered and collected via `getServices(IMeshServiceSource)`. */
export const IMeshServiceSource: ServiceToken<IMeshServiceSource> =
  serviceToken<IMeshServiceSource>('IMeshServiceSource');
