import { createServer, Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileSystemMeshArtifactStore,
  HttpMeshServiceSource,
  MeshAggregator,
} from '@benzenejs/mesh-aggregator';
import { MeshServiceRegistry, MeshServiceRegistryEntry, MeshServiceStatus, TopologyEdgeSource } from '@benzenejs/mesh-contracts';
import { BenzeneResultStatus } from '@benzenejs/results';

/**
 * Cross-language mesh interoperability - the "TypeScript + .NET services in one mesh" demonstration (NOT a
 * ported C# test). Everything that crosses a process boundary is a language-neutral wire contract
 * (docs/specification/wire-contracts.md + mesh.md): the benzene `spec` descriptor, the health document, and
 * the lowercase-kebab status vocabulary. So a service's runtime language is invisible on the wire - a .NET
 * service and a TypeScript service emit byte-identical shapes.
 *
 * Here two real `node:http` servers stand in for the two runtimes (the fixtures are exactly what each
 * language's Benzene runtime serves), and the real TypeScript `MeshAggregator` (over the real global
 * `fetch`, via `HttpMeshServiceSource`) polls both and links them: the .NET service *produces* a topic the
 * TypeScript service *consumes*, so the aggregator derives a cross-language topology edge between them.
 */

/** A minimal Benzene HTTP service: serves its `spec` descriptor (`type=benzene`) and `health` document. */
function benzeneService(specJson: string, healthJson: string, healthStatus = 200): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/benzene/spec' && url.searchParams.get('type') === 'benzene') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(specJson);
      return;
    }
    if (url.pathname === '/benzene/health') {
      res.writeHead(healthStatus, { 'content-type': 'application/json' }).end(healthJson);
      return;
    }
    // Unknown (e.g. the aggregator's best-effort type=asyncapi probe) - 404, as a real service would.
    res.writeHead(404).end();
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

// A healthy Benzene health document. The inner check `status` uses the normative kebab wire vocabulary -
// exactly what BenzeneResultStatus now emits, so a .NET and a TypeScript service write it identically.
const healthyDoc = JSON.stringify({ isHealthy: true, healthChecks: { self: { status: 'ok', type: 'Self' } } });
// An unhealthy document served with HTTP 503 - the way a real Benzene health endpoint reports unhealthy.
const unhealthyDoc = JSON.stringify({ isHealthy: false, healthChecks: { db: { status: 'service-unavailable', type: 'Database' } } });

describe('cross-language mesh interoperability', () => {
  let rootDirectory: string;
  const servers: Server[] = [];

  beforeEach(() => {
    rootDirectory = mkdtempSync(join(tmpdir(), 'benzene-cross-language-mesh-'));
  });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(close));
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('the TS aggregator links a .NET producer to a TS consumer in one mesh', async () => {
    // A .NET Benzene service: handles order:create over HTTP, and *produces* payment:take. This is exactly
    // the JSON `Benzene.Schema.OpenApi`'s spec endpoint serves - the aggregator can't tell it's .NET.
    const dotnetOrders = benzeneService(
      JSON.stringify({
        requests: [{ topic: 'order:create', httpMappings: [{ method: 'post', path: '/orders' }] }],
        events: [{ topic: 'payment:take', version: '1' }],
        transports: ['http', 'sqs'],
      }),
      healthyDoc,
    );
    // A TypeScript Benzene service: *consumes* payment:take. Same wire shape a TS runtime serves.
    const tsPayments = benzeneService(
      JSON.stringify({
        requests: [{ topic: 'payment:take', version: '1' }],
        transports: ['http'],
      }),
      healthyDoc,
    );
    servers.push(dotnetOrders, tsPayments);
    const ordersPort = await listen(dotnetOrders);
    const paymentsPort = await listen(tsPayments);

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([new HttpMeshServiceSource()], store);

    const manifest = await aggregator.runOnceAsync(
      new MeshServiceRegistry([
        new MeshServiceRegistryEntry('orders-api', `http://127.0.0.1:${ordersPort}/benzene/spec?type=benzene`, `http://127.0.0.1:${ordersPort}/benzene/health`),
        new MeshServiceRegistryEntry('payments-api', `http://127.0.0.1:${paymentsPort}/benzene/spec?type=benzene`, `http://127.0.0.1:${paymentsPort}/benzene/health`),
      ]),
    );

    // Both services aggregate into one manifest, both healthy - the language is invisible.
    expect(manifest.services).toHaveLength(2);
    expect(manifest.services.find((s) => s.name === 'orders-api')!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services.find((s) => s.name === 'payments-api')!.status).toBe(MeshServiceStatus.healthy);
    expect(manifest.services.find((s) => s.name === 'orders-api')!.transports).toEqual(['http', 'sqs']);

    // The cross-service topic catalog links the two runtimes: payment:take is produced by the .NET service
    // and consumed by the TypeScript service.
    const catalog = JSON.parse((await store.tryReadAsync('topics.json'))!) as {
      topics: { topic: string; producers: { service: string }[]; consumers: { service: string }[] }[];
    };
    const paymentTake = catalog.topics.find((t) => t.topic === 'payment:take')!;
    expect(paymentTake.producers.map((p) => p.service)).toEqual(['orders-api']);
    expect(paymentTake.consumers.map((c) => c.service)).toEqual(['payments-api']);

    // ...and the structural topology derives the cross-language edge: orders-api (.NET) -> payments-api (TS).
    const topology = JSON.parse((await store.tryReadAsync('topology.json'))!) as {
      edges: { client: string; server: string; source: string }[];
    };
    expect(topology.edges).toHaveLength(1);
    expect(topology.edges[0]).toMatchObject({ client: 'orders-api', server: 'payments-api', source: TopologyEdgeSource.structural });
  });

  it('reads a .NET service reporting unhealthy via HTTP 503 as unhealthy (not unreachable)', async () => {
    // A real Benzene health endpoint (any language) maps an unhealthy aggregate to HTTP 503, not a 200 with
    // isHealthy:false. The aggregator must still read the body across the language boundary.
    const dotnetService = benzeneService(JSON.stringify({ requests: [{ topic: 'order:create' }] }), unhealthyDoc, 503);
    servers.push(dotnetService);
    const port = await listen(dotnetService);

    const store = new FileSystemMeshArtifactStore(rootDirectory);
    const aggregator = new MeshAggregator([new HttpMeshServiceSource()], store);

    const manifest = await aggregator.runOnceAsync(
      new MeshServiceRegistry([new MeshServiceRegistryEntry('orders-api', `http://127.0.0.1:${port}/benzene/spec?type=benzene`, `http://127.0.0.1:${port}/benzene/health`)]),
    );

    expect(manifest.services[0]!.status).toBe(MeshServiceStatus.unhealthy);
  });

  it('classifies the .NET wire status vocabulary identically (the multi-language status contract)', () => {
    // The response envelope statusCode is a normative lowercase-kebab wire value (wire-contracts.md §3).
    // After correcting BenzeneResultStatus to those values, a status a .NET service writes classifies
    // identically in TypeScript - the precondition for the two sharing a mesh (and calling each other).
    expect(BenzeneResultStatus.ok).toBe('ok');
    expect(BenzeneResultStatus.notFound).toBe('not-found');
    expect(BenzeneResultStatus.isSuccess('ok')).toBe(true);
    expect(BenzeneResultStatus.isFailure('not-found')).toBe(true);
    expect(BenzeneResultStatus.isFailure('service-unavailable')).toBe(true);
    expect(BenzeneResultStatus.isTransient('too-many-requests')).toBe(true);
    // A PascalCase value (the pre-fix TS vocabulary) is NOT a known wire status - it would have been
    // unclassifiable to a .NET peer, which is exactly the interop break the fix removes.
    expect(BenzeneResultStatus.isKnown('NotFound')).toBe(false);
  });
});
