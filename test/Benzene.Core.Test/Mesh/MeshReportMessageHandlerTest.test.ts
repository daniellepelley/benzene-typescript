import { describe, expect, it } from 'vitest';
import { MeshReportMessageHandler } from '@benzenejs/mesh-aggregator';
import { IMeshReportPublisher, MeshServiceReport } from '@benzenejs/mesh-contracts';

/** Port of test/Benzene.Mesh.Test/MeshReportMessageHandlerTest.cs. */
class RecordingMeshReportPublisher implements IMeshReportPublisher {
  lastPublished: MeshServiceReport | undefined;

  publishAsync(report: MeshServiceReport): Promise<void> {
    this.lastPublished = report;
    return Promise.resolve();
  }
}

describe('MeshReportMessageHandler', () => {
  it('HandleAsync_DelegatesToRegisteredPublisher', async () => {
    const publisher = new RecordingMeshReportPublisher();
    const handler = new MeshReportMessageHandler(publisher);
    const report = new MeshServiceReport('payments-fn', Date.now(), '{}', undefined, undefined);

    await handler.handleAsync(report);

    expect(publisher.lastPublished).toBe(report);
  });
});
