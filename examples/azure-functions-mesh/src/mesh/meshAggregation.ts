/**
 * One discovery + aggregation pass: discover the benzene-tagged Azure resources (the six Function Apps),
 * write the discovered registry, interrogate each over HTTPS, and write the catalog artifacts. Shared by
 * the on-demand `POST /mesh/refresh` endpoint and the timer trigger. Mirrors .NET's
 * `Mesh/MeshAggregationService` + `Mesh/MeshRefreshHandler`.
 */
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IMeshArtifactStore, MeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshDiscoveryFilter, MeshDiscoveryRunner, MeshRegistryJson } from '@benzenejs/mesh-contracts';
import { BenzeneResult } from '@benzenejs/results';

/** One discover -> persist registry -> aggregate pass, serialized so overlapping callers never interleave writes. */
export class MeshAggregationService {
  private pending: Promise<number> | undefined;

  constructor(
    private readonly discovery: MeshDiscoveryRunner,
    private readonly store: IMeshArtifactStore,
    private readonly aggregator: MeshAggregator,
  ) {}

  /** Runs a pass and returns the number of services discovered. Single-flight: an overlapping call joins the pass already running. */
  async runAsync(): Promise<number> {
    if (this.pending !== undefined) {
      return this.pending;
    }

    this.pending = this.runOnceAsync().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async runOnceAsync(): Promise<number> {
    const region = process.env['MESH_REGION'];
    const filter = new MeshDiscoveryFilter(undefined, region !== undefined && region.trim() !== '' ? [region] : undefined);

    const registry = await this.discovery.discoverAsync(filter);
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
    try {
      const discovered = await this.aggregation.runAsync();
      const result = new MeshRefreshResult();
      result.discovered = discovered;
      return BenzeneResult.created(result);
    } catch (ex) {
      // A transient ARM throttle / interrogation error must not surface as a raw 500; the timer trigger
      // keeps retrying regardless. Never leak the exception message.
      const name = ex instanceof Error ? ex.constructor.name : 'Error';
      return BenzeneResult.serviceUnavailable<MeshRefreshResult>(`Mesh refresh failed: ${name}`);
    }
  }
}
