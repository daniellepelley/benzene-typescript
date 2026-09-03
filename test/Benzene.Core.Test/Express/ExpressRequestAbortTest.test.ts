import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ExpressContext } from '@benzenejs/express';

/**
 * `ExpressContext.signal` — the Express/Node analog of ASP.NET's `HttpContext.RequestAborted` (the
 * .NET R10 #104 / R17 #285 rule): it aborts when the client disconnects before the response
 * completes, and stays un-aborted for a normally-completed request. Driven over a REAL `node:http`
 * server (the same `IncomingMessage`/`ServerResponse` pair `@benzenejs/express` adapts), since the
 * wiring under test is Node's connection-close behaviour itself.
 */

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve) => {
          s.closeIdleConnections();
          s.close(() => resolve());
        }),
    ),
  );
});

function listen(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );
}

describe('ExpressContext request abort signal', () => {
  it('aborts when the client disconnects before the response is written', async () => {
    const aborted = new Promise<AbortSignal>((resolve) => {
      const server = createServer((req, res) => {
        const context = new ExpressContext(req, res, '');
        // Deliberately never respond; wait for the client to hang up.
        context.signal.addEventListener('abort', () => resolve(context.signal), { once: true });
      });
      void listen(server).then(async (baseUrl) => {
        const controller = new AbortController();
        const request = fetch(`${baseUrl}/slow`, { signal: controller.signal }).catch(() => undefined);
        // Give the request time to reach the server, then hang up.
        setTimeout(() => controller.abort(), 50);
        await request;
      });
    });

    const signal = await aborted;
    expect(signal.aborted).toBe(true);
  });

  it('does not abort for a normally-completed request', async () => {
    let signal: AbortSignal | undefined;
    const server = createServer((req, res) => {
      const context = new ExpressContext(req, res, '');
      signal = context.signal;
      res.statusCode = 200;
      res.end('ok');
    });
    const baseUrl = await listen(server);

    const response = await fetch(`${baseUrl}/ok`);
    expect(await response.text()).toBe('ok');

    // The connection closing AFTER the response ended must not read as a client abort.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
  });
});
