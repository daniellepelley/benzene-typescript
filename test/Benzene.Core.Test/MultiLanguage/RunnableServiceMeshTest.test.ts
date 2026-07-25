import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunningService, startOrderService } from '@benzene-example/mesh-service';
import { FileSystemMeshArtifactStore, HttpMeshServiceSource, MeshAggregator } from '@benzene/mesh-aggregator';
import { MeshServiceRegistry, MeshServiceRegistryEntry, MeshServiceStatus } from '@benzene/mesh-contracts';

/**
 * Drives the real `@benzene/mesh-aggregator` against the runnable `@benzene-example/mesh-service` - a live
 * TypeScript Benzene HTTP service (Express + real handlers + a registry-derived spec), started on a real
 * port and polled over the real global `fetch`. It proves the example service is genuinely
 * mesh-discoverable: the aggregator catalogs its topics and HTTP mappings from what the running service
 * self-describes, which is the same thing a .NET mesh aggregator would do (the spec/health endpoints are
 * language-neutral wire contracts).
 */
describe('runnable TypeScript service in a mesh', () => {
  let rootDirectory: string;
  let service: RunningService;

  beforeEach(async () => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-runnable-service-mesh-'));
    service = await startOrderService();
  });

  afterEach(async () => {
    await service.close();
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('the aggregator discovers the live service and catalogs its self-derived topics', async () => {
    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([new HttpMeshServiceSource()], store);

    const manifest = await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-ts', `${service.url}/benzene/spec?type=benzene`, `${service.url}/benzene/health`),
      ]),
    );

    // The live service is reachable and healthy, and advertises HTTP transport.
    expect(manifest.services).toHaveLength(1);
    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services[0]!.transports).toEqual(['http']);

    // The topic catalog is derived from the running handlers: order:create (POST /orders) + order:get.
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: { topic: string; consumers: { service: string; httpMappings: { method: string; path: string }[] }[] }[];
    };
    const topicIds = catalog.topics.map((t) => t.topic).sort();
    expect(topicIds).toEqual(['order:create', 'order:get']);

    const create = catalog.topics.find((t) => t.topic === 'order:create')!;
    expect(create.consumers[0]!.service).toBe('orders-ts');
    expect(create.consumers[0]!.httpMappings).toContainEqual({ method: 'post', path: '/orders' });
  });

  it('the live service actually handles a message (it is a real Benzene service, not a stub)', async () => {
    const response = await fetch(`${service.url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'acme' }),
    });

    expect(response.status).toBe(201); // BenzeneResult.created -> HTTP 201
    expect(await response.json()).toEqual({ orderId: 'order-acme' });
  });
});
