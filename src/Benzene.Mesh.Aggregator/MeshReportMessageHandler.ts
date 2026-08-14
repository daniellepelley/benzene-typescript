/** Port of Benzene.Mesh.Aggregator.MeshReportMessageHandler. */
import { IMessageHandlerNoResponse } from '@benzenejs/abstractions-message-handlers';
import { IMeshReportPublisher, MeshServiceReport } from '@benzenejs/mesh-contracts';

/**
 * The push/self-report ingestion endpoint - accepts a `MeshServiceReport` and hands it to whichever
 * `IMeshReportPublisher` is registered (`ArtifactStoreMeshReportPublisher` by default, via
 * `addMeshAggregator`). Reachable on whatever transport the host already runs, the same dogfooded shape as
 * `MeshAggregateMessageHandler`. `IMessageHandler<MeshServiceReport>` (no response) ->
 * `IMessageHandlerNoResponse<MeshServiceReport>`.
 */
export class MeshReportMessageHandler implements IMessageHandlerNoResponse<MeshServiceReport> {
  constructor(private readonly publisher: IMeshReportPublisher) {}

  handleAsync(request: MeshServiceReport): Promise<void> {
    return this.publisher.publishAsync(request);
  }
}
