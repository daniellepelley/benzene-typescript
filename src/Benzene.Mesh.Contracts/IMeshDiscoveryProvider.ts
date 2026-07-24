/** Port of Benzene.Mesh.Contracts.IMeshDiscoveryProvider. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { MeshDiscoveryFilter } from './MeshDiscoveryFilter';
import { MeshServiceRegistryEntry } from './MeshServiceRegistryEntry';

/**
 * Enumerates the services that currently exist in some environment (a cloud account, a cluster) and
 * produces the `MeshServiceRegistryEntry` records a mesh aggregator would otherwise be hand-fed from a
 * static `mesh.json`. The "self-discovery" seam: an adapter package (AWS/Azure/Kubernetes) implements it.
 * `CancellationToken` -> optional `AbortSignal`; multiple providers compose via `getServices`.
 */
export interface IMeshDiscoveryProvider {
  /** A stable key identifying this provider (e.g. the platform it discovers). */
  readonly key: string;

  /** Enumerates services matching `filter` and returns their registry entries. */
  discoverAsync(
    filter: MeshDiscoveryFilter,
    cancellationToken?: AbortSignal,
  ): Promise<readonly MeshServiceRegistryEntry[]>;
}

/** Container token: providers are registered and collected via `getServices(IMeshDiscoveryProvider)`. */
export const IMeshDiscoveryProvider: ServiceToken<IMeshDiscoveryProvider> =
  serviceToken<IMeshDiscoveryProvider>('IMeshDiscoveryProvider');
