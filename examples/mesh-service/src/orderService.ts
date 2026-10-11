/**
 * Assembles the runnable order service: a real Benzene HTTP service (the `@benzenejs/express` adapter routes
 * the message handlers) that also serves the two endpoints a mesh aggregator interrogates - `/benzene/spec`
 * (its derived Contract Document, through the Benzene pipeline) and `/benzene/health`. Because those are
 * language-neutral wire contracts, a .NET, Go or TypeScript aggregator - or client generator - can catalog this
 * TypeScript service with no knowledge that it's written in TypeScript.
 */
import { type AddressInfo } from 'node:net';
import express, { type Express } from 'express';
import { benzene } from '@benzenejs/express';
import { useOrderService } from './contract';
import { buildHealth } from './health';

/** Builds the Express app: Benzene owns the message routes and `/benzene/spec`, Express the health route. */
export function createOrderService(): Express {
  const app = express();

  // Benzene owns POST /orders, GET /orders/:id and GET /benzene/spec (mounted before any body parser so it
  // reads the raw body). `GET /benzene/spec?type=openapi|asyncapi` is served too; any other type is a 501.
  app.use(benzene((pipeline) => useOrderService(pipeline)));

  // Benzene owns no route here, so the strangler middleware falls through to this ordinary Express route.
  app.get('/benzene/health', (_req, res) => {
    res.type('application/json').send(buildHealth());
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
