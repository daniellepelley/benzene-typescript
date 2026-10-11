import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunningService, startOrderService } from '@benzene-example/mesh-service';
import { FileSystemMeshArtifactStore, HttpMeshServiceSource, MeshAggregator } from '@benzenejs/mesh-aggregator';
import { MeshServiceRegistry, MeshServiceRegistryEntry, MeshServiceStatus } from '@benzenejs/mesh-contracts';

/**
 * Drives the real `@benzenejs/mesh-aggregator` against the runnable `@benzene-example/mesh-service` - a live
 * TypeScript Benzene HTTP service (Express + real handlers + a `useSpec`-derived Contract Document), started on a real
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

    // The live service is reachable and healthy, and advertises the transport it is hosted on.
    expect(manifest.services).toHaveLength(1);
    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services[0]!.transports).toEqual(['express']);

    // The topic catalog is derived from the served Contract Document: the running handlers order:create
    // (POST /orders) + order:get, and the declared send payments:capture, which this service produces.
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: {
        topic: string;
        consumers: { service: string; httpMappings: { method: string; path: string }[] }[];
        producers: { service: string }[];
      }[];
    };
    const topicIds = catalog.topics.map((t) => t.topic).sort();
    expect(topicIds).toEqual(['order:create', 'order:get', 'payments:capture']);
    const capture = catalog.topics.find((t) => t.topic === 'payments:capture')!;
    expect(capture.producers.map((p) => p.service)).toEqual(['orders-ts']);
    expect(capture.consumers).toEqual([]);

    const create = catalog.topics.find((t) => t.topic === 'order:create')!;
    expect(create.consumers[0]!.service).toBe('orders-ts');
    expect(create.consumers[0]!.httpMappings).toContainEqual({ method: 'POST', path: '/orders' });
  });

  it('the live service serves its Contract Document - the body it would register with a collector (mesh.md §2)', async () => {
    // One self-description: the document `benzene:spec` serves is the register body (spec 3b). Derived from
    // the running registry, the declared outbound, and the service's identity and placement.
    const response = await fetch(`${service.url}/benzene/spec`);
    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      schemaDialect: string;
      service: string;
      serviceVersion: string;
      versionScheme: string;
      runtime: string;
      placement: { cloud: string };
      degraded?: string[];
      requests: { topic: string; request?: unknown }[];
      events: { topic: string }[];
      sends: { topic: string; request?: unknown; response?: unknown }[];
      components: { schemas: Record<string, unknown> };
      contractHash: string;
      registrationHash: string;
    };

    expect(document.schemaDialect).toBe('openapi-3.0');
    expect(document.service).toBe('orders');
    expect(document.serviceVersion).toBe('1.0.0');
    expect(document.versionScheme).toBe('semver');
    expect(document.runtime).toBe('typescript'); // this port's runtime identifier (contract-document.md §1)
    expect(document.placement.cloud).toBe('self-hosted');
    // Every member is determined: the handlers, and a complete (empty-events) outbound declaration.
    expect(document.degraded).toBeUndefined();

    // requests are the running handlers' topics (the consumer side of the mesh graph), each with its schema.
    expect(document.requests.map((r) => r.topic).sort()).toEqual(['order:create', 'order:get']);
    expect(document.components.schemas['CreateOrder']).toEqual({
      type: 'object',
      properties: { customerId: { type: 'string' } },
    });

    // sends is the declared outbound: what lets a collector draw the orders -> payments PROVIDER edge from the
    // registration alone, before any message has ever flowed (mesh.md §4). A one-way send has no response.
    expect(document.events).toEqual([]);
    expect(document.sends.map((s) => s.topic)).toEqual(['payments:capture']);
    expect('response' in document.sends[0]!).toBe(false);

    // Both hashes (contract-document.md §6): "sha256:" + 64 lowercase hex chars.
    expect(document.contractHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(document.registrationHash).toMatch(/^sha256:[0-9a-f]{64}$/);
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
