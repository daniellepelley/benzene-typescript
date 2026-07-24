import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VoidResult } from '@benzene/abstractions';
import { FileSystemMeshArtifactStore } from '@benzene/mesh-aggregator';
import { TopologyEdgeSource } from '@benzene/mesh-contracts';
import {
  PrometheusQueryClient,
  TempoServiceGraphTopologyBuilder,
  TempoTopologyMessageHandler,
  TempoTopologyOptions,
} from '@benzene/mesh-tracing-tempo';

/** Port of test/Benzene.Mesh.Test/TempoTopologyMessageHandlerTest.cs. `Void` -> `VoidResult`. */
function fixedResponseFetch(body: string): typeof fetch {
  return ((_url: string) => Promise.resolve(new Response(body, { status: 200 }))) as unknown as typeof fetch;
}

describe('TempoTopologyMessageHandler', () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-mesh-tempo-test-'));
  });

  afterEach(() => {
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('HandleAsync_PublishesTopologyJson_ToTheGivenStore', async () => {
    const body = `
    {
      "status": "success",
      "data": {
        "resultType": "vector",
        "result": [
          { "metric": { "client": "orders-api", "server": "payments-api" }, "value": [1700000000, "12"] }
        ]
      }
    }`;
    const client = new PrometheusQueryClient(fixedResponseFetch(body));
    const options = new TempoTopologyOptions('https://prometheus.example/api/v1/query');
    const builder = new TempoServiceGraphTopologyBuilder(client, options);
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const handler = new TempoTopologyMessageHandler(builder, store);

    const result = await handler.handleAsync(new VoidResult());

    expect(result.isSuccessful).toBe(true);
    const published = await store.tryReadAsync('topology.json');
    expect(published).not.toBeUndefined();

    const deserialized = JSON.parse(published!) as { edges: { client: string; server: string; source: string }[] };
    expect(deserialized.edges).toHaveLength(1);
    expect(deserialized.edges[0]!.client).toBe('orders-api');
    expect(deserialized.edges[0]!.server).toBe('payments-api');
    expect(deserialized.edges[0]!.source).toBe(TopologyEdgeSource.tempo);
  });
});
