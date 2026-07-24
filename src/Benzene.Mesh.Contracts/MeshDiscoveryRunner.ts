/** Port of Benzene.Mesh.Contracts.MeshDiscoveryRunner. */
import { IMeshDiscoveryProvider } from './IMeshDiscoveryProvider';
import { MeshDiscoveryFilter } from './MeshDiscoveryFilter';
import { MeshServiceRegistry } from './MeshServiceRegistry';
import { MeshServiceRegistryEntry } from './MeshServiceRegistryEntry';

/**
 * Runs the discovery phase: executes every registered `IMeshDiscoveryProvider`, unions the results with an
 * optional hand-written static seed, de-duplicates by service name (case-insensitive), and returns the
 * `MeshServiceRegistry` the aggregator will consume.
 */
export class MeshDiscoveryRunner {
  private readonly providers: readonly IMeshDiscoveryProvider[];

  constructor(providers: Iterable<IMeshDiscoveryProvider>) {
    this.providers = [...providers];
  }

  /**
   * Discovers services and merges them with `staticSeed`. On a name clash the seed (and then an earlier
   * provider) wins - a hand-pinned entry is an intentional human override discovery must not replace.
   */
  async discoverAsync(
    filter: MeshDiscoveryFilter,
    staticSeed?: MeshServiceRegistry,
    cancellationToken?: AbortSignal,
  ): Promise<MeshServiceRegistry> {
    // Keyed by lower-cased name (C#'s OrdinalIgnoreCase dictionary), holding the original entry.
    const byName = new Map<string, MeshServiceRegistryEntry>();

    if (staticSeed !== undefined) {
      for (const entry of staticSeed.services) {
        byName.set(entry.name.toLowerCase(), entry);
      }
    }

    for (const provider of this.providers) {
      const discovered = await provider.discoverAsync(filter, cancellationToken);
      for (const entry of discovered) {
        const key = entry.name.toLowerCase();
        if (!byName.has(key)) {
          byName.set(key, entry);
        }
      }
    }

    return new MeshServiceRegistry([...byName.values()]);
  }
}
