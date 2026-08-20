import { afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { rm } from 'node:fs/promises';
import { createServiceApp } from '../../../examples/k8s-mesh/src/serviceApp';
import { createMeshApp } from '../../../examples/k8s-mesh/src/meshApp';

/**
 * End-to-end test for `examples/k8s-mesh` — the TypeScript port of .NET's `examples/K8sMesh`. Runs the
 * three domain services and the mesh as real Express apps on ephemeral ports (no Docker/Kubernetes
 * involved; that half is verified separately by the `mesh-example-k8s-deploy.yml` workflow's `kind`
 * run), and drives the same surfaces that workflow asserts: the orders -> payments -> shipping chain
 * over `/benzene-message`, the Cloud Service Profile endpoints, and the mesh's UI/artifacts/refresh.
 *
 * `npx tsc --noEmit` alone does not catch the bugs this test does: `@benzenejs/express`'s `benzene()`
 * middleware only hands a request to the Benzene pipeline when a registered `IHttpEndpointDefinition`
 * matches its method+path, so a plain-looking wiring omission here 404s at RUNTIME with no compile-time
 * signal — this test is what actually exercises that gate for every path the example serves.
 */

interface RunningApp {
  url: string;
  close: () => Promise<void>;
}

function listen(app: ReturnType<typeof createServiceApp>): Promise<RunningApp> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://localhost:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe('K8sMeshExampleTest', () => {
  const closers: (() => Promise<void>)[] = [];
  const artifactDirs: string[] = [];

  afterAll(async () => {
    await Promise.all(closers.map((c) => c()));
    await Promise.all(artifactDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('chains orders -> payments -> shipping over /benzene-message and serves the Cloud Service Profile', async () => {
    // Wired back-to-front so each DOWNSTREAM_MSG_URL points at an already-listening service, mirroring
    // how k8s/services.yaml wires the chain via in-cluster DNS.
    process.env['DOWNSTREAM_MSG_URL'] = '';
    const shippingHost = await listen(createServiceApp('shipping'));
    closers.push(shippingHost.close);

    process.env['DOWNSTREAM_MSG_URL'] = `${shippingHost.url}/benzene-message`;
    const paymentsHost = await listen(createServiceApp('payments'));
    closers.push(paymentsHost.close);

    process.env['DOWNSTREAM_MSG_URL'] = `${paymentsHost.url}/benzene-message`;
    const ordersHost = await listen(createServiceApp('orders'));
    closers.push(ordersHost.close);
    delete process.env['DOWNSTREAM_MSG_URL'];

    // The REST route (@httpEndpoint) kicks off the whole chain in one call.
    const orderRes = await fetch(`${ordersHost.url}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: 'c-1', sku: 'espresso', quantity: 2 }),
    });
    expect(orderRes.status).toBe(201);
    const order = (await orderRes.json()) as { orderId: string; status: string };
    expect(order.status).toBe('created');
    expect(order.orderId).toMatch(/^order-/);

    // The raw envelope endpoint, addressed directly (the same contract a downstream client, or the
    // mesh's own interrogation, uses) — POST payment:take straight at payments.
    const envelopeRes = await fetch(`${paymentsHost.url}/benzene-message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic: 'payment:take',
        headers: {},
        body: JSON.stringify({ orderId: 'o-9', amount: 30 }),
      }),
    });
    expect(envelopeRes.status).toBe(201);
    const envelope = (await envelopeRes.json()) as { statusCode: string; body: string };
    expect(envelope.statusCode).toBe('created');
    expect(JSON.parse(envelope.body)).toMatchObject({ status: 'captured' });

    // The Cloud Service Profile's own surfaces: health, spec, invoke, and the Spec UI page.
    expect((await fetch(`${ordersHost.url}/benzene/health`)).status).toBe(200);
    expect((await fetch(`${ordersHost.url}/benzene/spec?type=benzene`)).status).toBe(200);
    expect((await fetch(`${ordersHost.url}/benzene/spec-ui`)).status).toBe(200);
    const invokeRes = await fetch(`${ordersHost.url}/benzene/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic: 'benzene:healthcheck', headers: {}, body: '' }),
    });
    expect(invokeRes.status).toBe(200);
  });

  it('serves the Mesh UI, artifacts, and /mesh/refresh, degrading gracefully with no in-cluster Kubernetes API', async () => {
    const artifactDir = `/tmp/k8s-mesh-example-test-${Date.now()}`;
    artifactDirs.push(artifactDir);
    const { app, aggregation } = createMeshApp(artifactDir);
    const meshHost = await listen(app);
    closers.push(meshHost.close);

    // No in-cluster Kubernetes API in a test process -> discovery degrades to zero rather than failing
    // the request (see meshAggregation.ts's runAsync), same posture the mesh-example-k8s-deploy.yml
    // workflow's `kind` run asserts the opposite of (discovered:3, with a real cluster behind it).
    const refreshRes = await fetch(`${meshHost.url}/mesh/refresh`, { method: 'POST' });
    expect(refreshRes.status).toBe(201);
    const refreshed = (await refreshRes.json()) as { discovered: number };
    expect(refreshed.discovered).toBe(0);
    expect(typeof aggregation.runAsync).toBe('function');

    const uiRes = await fetch(`${meshHost.url}/mesh-ui`);
    expect(uiRes.status).toBe(200);
    expect(uiRes.headers.get('content-type')).toContain('text/html');

    expect((await fetch(`${meshHost.url}/mesh-spec-ui.html`)).status).toBe(200);

    // The published catalog is also reachable as a plain static file (see meshApp.ts's module comment).
    expect((await fetch(`${meshHost.url}/manifest.json`)).status).toBe(200);
  });
});
