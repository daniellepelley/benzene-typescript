/** Port of Benzene.Mesh.Aggregator.UnknownMeshServiceSource. */
import { MeshServiceRegistryEntry } from '@benzenejs/mesh-contracts';
import { IMeshServiceSource } from './IMeshServiceSource';

/**
 * Stand-in `IMeshServiceSource` returned when a `MeshServiceRegistryEntry.source` has no matching
 * registered source - throws from both fetch methods so a misconfigured single entry surfaces as that
 * service's own `unreachable`/error result (via the same try/catch every other fetch failure goes through
 * in `MeshAggregator`), rather than crashing the whole aggregation run.
 */
export class UnknownMeshServiceSource implements IMeshServiceSource {
  readonly key: string;

  constructor(private readonly requestedSource: string) {
    this.key = requestedSource;
  }

  fetchSpecAsync(_entry: MeshServiceRegistryEntry, _cancellationToken?: AbortSignal): Promise<string> {
    throw this.notRegistered();
  }

  fetchHealthAsync(_entry: MeshServiceRegistryEntry, _cancellationToken?: AbortSignal): Promise<string> {
    throw this.notRegistered();
  }

  private notRegistered(): Error {
    return new Error(`No IMeshServiceSource registered for source "${this.requestedSource}".`);
  }
}
