/**
 * Drives `@benzene-example/express-http` against a REAL Express server on an ephemeral loopback port,
 * exactly as the port's own `@benzene/express` integration tests do: create an order over `POST /orders`,
 * read it back over `GET /orders`, and confirm the strangler fall-through to the plain `/healthz` route.
 * The Node/Express analog of the .NET `Benzene.Example.Asp` integration tests.
 */
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrderService } from '@benzene-example/express-http';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function start(): Promise<string> {
  const server = createOrderService().listen(0);
  servers.push(server);
  return new Promise((resolve) =>
    server.on('listening', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

describe('@benzene-example/express-http', () => {
  it('POST /orders creates an order and GET /orders lists it', async () => {
    const baseUrl = await start();

    const created = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'acme' }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ id: 'order-1', name: 'acme' });

    const listed = await fetch(`${baseUrl}/orders`);
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as { orders: { name: string }[] };
    expect(list.orders.map((o) => o.name)).toEqual(['acme']);
  });

  it('falls through to the plain Express /healthz route Benzene does not own', async () => {
    const baseUrl = await start();

    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
