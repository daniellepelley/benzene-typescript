/**
 * Assembles the runnable order service: a real Benzene HTTP service (the `@benzenejs/express` adapter routes
 * the message handlers) that also serves the two mesh-contract endpoints a mesh aggregator interrogates -
 * `/benzene/spec` (its self-derived descriptor) and `/benzene/health`. Because those are language-neutral
 * wire contracts, a .NET (or TypeScript) mesh aggregator can discover and catalog this TypeScript service
 * with no knowledge that it's written in TypeScript.
 */
import { type AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { benzene } from '@benzenejs/express';
import { MeshJson } from '@benzenejs/mesh-wire';
import { buildBenzeneSpec } from './benzeneSpec';
import { buildDescriptor } from './benzeneDescriptor';
import { buildHealth } from './health';
import { CreateOrderHandler, GetOrderHandler, registry } from './handlers';

/** Builds the Express app: Benzene owns the message routes, plus the two mesh-contract endpoints. */
export function createOrderService(): Express {
  const app = express();

  // Benzene owns POST /orders and GET /orders/:id (mounted before any body parser so it reads the raw body).
  app.use(benzene((pipeline) => useMessageHandlers(pipeline, CreateOrderHandler, GetOrderHandler)));

  // The mesh-contract endpoints. Benzene owns no route here, so the strangler middleware falls through to
  // these ordinary Express routes.
  app.get('/benzene/spec', (req, res) => {
    // The aggregator probes `?type=asyncapi` best-effort too; this service serves only the benzene descriptor.
    if (req.query['type'] !== undefined && req.query['type'] !== 'benzene') {
      res.status(404).end();
      return;
    }
    res.type('application/json').send(buildBenzeneSpec(registry));
  });
  app.get('/benzene/health', (_req, res) => {
    res.type('application/json').send(buildHealth());
  });

  // The normative mesh ServiceDescriptor (mesh.md §2), derived from the same running registry and carrying
  // its per-port `descriptorHash`. In a message-transport deployment this is served over the reserved `benzene:mesh`
  // topic via `useMeshDescriptor`; here it's exposed as an HTTP route so `curl` (and the demo test) can read
  // the identical cross-language shape.
  const descriptor = buildDescriptor(registry);
  app.get('/benzene/descriptor', (_req, res) => {
    res.type('application/json').send(MeshJson.serialize(descriptor));
  });

  return app;
}

/** A started service: its base URL and a `close()` to stop it. */
export interface RunningService {
  readonly url: string;
  close(): Promise<void>;
}

/** Starts the service listening on `port` (0 = an ephemeral port) and resolves once it's accepting requests. */
export function startOrderService(port = 0): Promise<RunningService> {
  const app = createOrderService();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const boundPort = (server.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${boundPort}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
