/** Port of Benzene.Mesh.Aggregator.MeshAggregateMessageHandler. */
import { IBenzeneResultOf, VoidResult } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MeshManifest, MeshServiceRegistry } from '@benzene/mesh-contracts';
import { BenzeneResult } from '@benzene/results';
import { MeshAggregator } from './MeshAggregator';

/**
 * Exposes `MeshAggregator.runOnceAsync` as a Benzene message handler - reachable on whatever transport the
 * host already runs (HTTP, a scheduled invocation, a queue message) with no bespoke hosting code.
 *
 * The C# `[HttpEndpoint("POST", "/mesh/aggregate")]` + `[Message("mesh:aggregate")]` attributes are declared
 * in `addMeshAggregator` (as registered `IHttpEndpointDefinition`/`IMessageHandlerDefinition`s) rather than
 * class decorators - the port's Extensions-registration convention, since JS has no assembly scan.
 * `Void` request -> `VoidResult`.
 */
export class MeshAggregateMessageHandler implements IMessageHandler<VoidResult, MeshManifest> {
  constructor(
    private readonly aggregator: MeshAggregator,
    private readonly registry: MeshServiceRegistry,
  ) {}

  async handleAsync(_request: VoidResult): Promise<IBenzeneResultOf<MeshManifest>> {
    const manifest = await this.aggregator.runOnceAsync(this.registry);
    return BenzeneResult.ok(manifest);
  }
}
