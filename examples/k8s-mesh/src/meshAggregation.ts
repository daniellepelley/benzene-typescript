/**
 * One discovery + aggregation pass: discover the benzene-labelled Kubernetes Services, write the
 * discovered registry to the artifact store (the "discovery creates the config" seam), interrogate each
 * over HTTP, and write the catalog artifacts. Shared by the on-demand `POST /mesh/refresh` endpoint and
 * the periodic background loop — the TypeScript port of .NET Mesh's `MeshAggregationService` +
 * `MeshRefreshHandler` + `MeshAggregationBackgroundService`.
 */
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IMeshArtifactStore, MeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshDiscoveryFilter, MeshDiscoveryRunner, MeshRegistryJson, MeshServiceRegistry } from '@benzenejs/mesh-contracts';
import { BenzeneResult } from '@benzenejs/results';

export class MeshAggregationService {
  constructor(
    private readonly discovery: MeshDiscoveryRunner,
    private readonly store: IMeshArtifactStore,
    private readonly aggregator: MeshAggregator,
  ) {}

  /**
   * Runs a pass and returns the number of services discovered. A discovery failure (no in-cluster
   * Kubernetes API reachable — e.g. this process isn't actually running as a pod) degrades to an empty
   * registry rather than failing the whole request: `POST /mesh/refresh` still answers
   * `{"discovered":0}` and the Mesh UI still serves, matching the framework's own posture elsewhere (an
   * unreachable mesh collector never fails a Cloud Service either). Inside a real Deployment (kind/EKS)
   * discovery is expected to succeed and this path is never taken.
   */
  async runAsync(): Promise<number> {
    const namespaceEnv = process.env['MESH_NAMESPACE'];
    const namespaceValue = namespaceEnv !== undefined && namespaceEnv.trim() !== '' ? namespaceEnv : undefined;
    const filter = new MeshDiscoveryFilter(undefined, undefined, namespaceValue);

    const registry = await this.discovery.discoverAsync(filter).catch((err: unknown) => {
      console.warn('mesh: discovery pass failed; treating as zero services discovered.', err);
      return new MeshServiceRegistry([]);
    });
    await this.store.publishAsync('registry.json', MeshRegistryJson.serialize(registry));
    await this.aggregator.runOnceAsync(registry);
    return registry.services.length;
  }
}

/** The outcome of a mesh refresh — `{"discovered": N}` on the wire. */
export class MeshRefreshResult {
  discovered = 0;
}

/** On-demand discovery + aggregation trigger: `POST /mesh/refresh` runs a pass and returns the count. */
export class MeshRefreshHandler implements IMessageHandler<VoidResult, MeshRefreshResult> {
  constructor(private readonly aggregation: MeshAggregationService) {}

  async handleAsync(_request: VoidResult): Promise<IBenzeneResultOf<MeshRefreshResult>> {
    const discovered = await this.aggregation.runAsync();
    const result = new MeshRefreshResult();
    result.discovered = discovered;
    return BenzeneResult.created(result);
  }
}

/**
 * Runs a discovery + aggregation pass on an interval (the Kubernetes analogue of a scheduled trigger),
 * so the catalog stays fresh without anyone hitting `/mesh/refresh`. Failures are swallowed and retried
 * next tick — a transient API/interrogation error must not crash the mesh process. Returns a stop
 * function.
 */
export function startBackgroundAggregation(aggregation: MeshAggregationService, intervalMs = 30_000): () => void {
  const tick = (): void => {
    aggregation.runAsync().catch((err: unknown) => {
      console.error('mesh background aggregation pass failed', err);
    });
  };

  tick(); // run once immediately so a fresh deployment doesn't wait a full interval for its first pass
  const timer = setInterval(tick, intervalMs);
  timer.unref?.(); // never keep the process alive on its own

  return () => clearInterval(timer);
}
