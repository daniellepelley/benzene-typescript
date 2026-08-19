import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
} from '@benzenejs/abstractions-middleware';
import { message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { useExpress } from '@benzenejs/express';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneHost, useWorker } from '@benzenejs/self-host';

/**
 * `useExpress` — the HTTP leg of a self-hosted worker, so HTTP sits alongside `useSqs`/`useKafka` in one
 * `useWorker(...)` block and one process serves all of them (the TypeScript counterpart of .NET's
 * `UseAspNet` inside `UseWorker`, exercised by .NET's examples/K8sTransports).
 *
 * Driven end to end through the real thing: a startup, `BenzeneHost.runAsync` as the whole entry point,
 * a real `fetch` over a real socket, and a real shutdown.
 */

class PlaceOrder {
  customerId = '';
}

class OrderPlaced {
  orderId = '';
}

@httpEndpoint('POST', '/orders')
@message('order:place', { register: false, requestType: PlaceOrder, responseType: OrderPlaced })
class PlaceOrderHandler implements IMessageHandler<PlaceOrder, OrderPlaced> {
  handleAsync(request: PlaceOrder): Promise<IBenzeneResultOf<OrderPlaced>> {
    return Promise.resolve(BenzeneResult.created<OrderPlaced>({ orderId: `order-${request.customerId}` }));
  }
}

/** The whole service: what it handles and what it listens on. Nothing about hosting leaves this class. */
function ordersStartUp(port: number): new () => BenzeneStartUp {
  return class implements BenzeneStartUp {
    configureServices(_services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {}

    configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
      useWorker(app, (workers) =>
        useExpress(workers, { port, host: '127.0.0.1' }, (http) =>
          useMessageHandlers(http, PlaceOrderHandler),
        ),
      );
    }
  };
}

/** Binds an ephemeral port, notes it, and releases it — so the worker under test can claim it. */
async function freePort(): Promise<number> {
  const probe = createServer();
  const port = await new Promise<number>((resolve) => {
    probe.listen(0, '127.0.0.1', () => resolve((probe.address() as AddressInfo).port));
  });
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Waits for the worker to be accepting connections (start is async; the socket binds a tick later). */
async function waitUntilServing(port: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${port}/nope`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error(`nothing listening on ${port}`);
}

describe('useExpress — Benzene owns the listener', () => {
  it('serves a handler over a real socket and shuts down on the abort signal', async () => {
    const port = await freePort();
    const controller = new AbortController();

    // The entire entry point a service ships.
    const run = BenzeneHost.runAsync(ordersStartUp(port), {
      signal: controller.signal,
      shutdownSignals: [],
    });
    await waitUntilServing(port);

    const response = await fetch(`http://127.0.0.1:${port}/orders`, {
      method: 'POST',
      body: JSON.stringify({ customerId: 'acme' }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ orderId: 'order-acme' });

    // A route no handler owns: Benzene owns this listener, so there is nothing to fall through to.
    const missing = await fetch(`http://127.0.0.1:${port}/nope`);
    expect(missing.status).toBe(404);

    controller.abort();
    await run;

    // The socket is closed: the next request cannot connect.
    await expect(
      fetch(`http://127.0.0.1:${port}/orders`, { method: 'POST', body: '{}' }),
    ).rejects.toThrow();
  });

  it('fails start-up when the port is already taken, rather than serving nothing', async () => {
    const port = await freePort();
    const first = new AbortController();
    const runFirst = BenzeneHost.runAsync(ordersStartUp(port), {
      signal: first.signal,
      shutdownSignals: [],
    });
    await waitUntilServing(port);

    await expect(BenzeneHost.runAsync(ordersStartUp(port), { shutdownSignals: [] })).rejects.toThrow(
      /EADDRINUSE/,
    );

    first.abort();
    await runFirst;
  });
});
