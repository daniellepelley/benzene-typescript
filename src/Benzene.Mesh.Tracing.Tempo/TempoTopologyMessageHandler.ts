/** Port of Benzene.Mesh.Tracing.Tempo.TempoTopologyMessageHandler. */
import { IBenzeneResultOf, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IMeshArtifactStore } from '@benzenejs/mesh-aggregator';
import { MeshTopology } from '@benzenejs/mesh-contracts';
import { BenzeneResult } from '@benzenejs/results';
import { TempoServiceGraphTopologyBuilder } from './TempoServiceGraphTopologyBuilder';

/**
 * Exposes `TempoServiceGraphTopologyBuilder.buildAsync` as a Benzene message handler and publishes the
 * result as `topology.json` - reachable on whatever transport the host already runs, the same "dogfooded"
 * shape as `MeshAggregateMessageHandler`.
 *
 * The C# `[HttpEndpoint("POST", "/mesh/topology")]` + `[Message("benzene:mesh:topology")]` attributes are declared
 * in `addTempoTopology` (as registered `IHttpEndpointDefinition`/`IMessageHandlerDefinition`s), the port's
 * Extensions-registration convention. `Void` request -> `VoidResult`.
 */
export class TempoTopologyMessageHandler implements IMessageHandler<VoidResult, MeshTopology> {
  constructor(
    private readonly builder: TempoServiceGraphTopologyBuilder,
    private readonly store: IMeshArtifactStore,
  ) {}

  async handleAsync(_request: VoidResult): Promise<IBenzeneResultOf<MeshTopology>> {
    const topology = await this.builder.buildAsync();
    await this.store.publishAsync('topology.json', JSON.stringify(topology, null, 2));

    return BenzeneResult.ok(topology);
  }
}
