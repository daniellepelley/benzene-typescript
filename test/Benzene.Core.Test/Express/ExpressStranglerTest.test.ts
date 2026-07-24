import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { benzene } from '@benzene/express';

/**
 * Integration tests for `@benzene/express` against a REAL Express app: Benzene handles the verbs+URLs it
 * has `@httpEndpoint` handlers for, and everything else falls through to the ordinary Express pipeline -
 * the strangler-fig pattern. No C# counterpart (ASP.NET Core is .NET-specific); these prove the Node/JS
 * host adaptation end to end.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// A parameterized GET route, to prove Benzene matches `/orders/:id`-style routes. The handler returns a
// fixed value rather than echoing the path param: on a bodyless request the port's RequestMapper yields
// `{} as TRequest` (TypeScript can't default-construct the erased DTO the way C#'s Activator.CreateInstance
// does), so `enrich` has no `orderId` property to populate - a documented port-wide limitation, not
// Express-specific (the ApiGateway tests likewise only assert body-provided fields).
@httpEndpoint('GET', '/orders/{orderId}')
@message('get-order', { registry, requestType: Order, responseType: OrderCreated })
class GetOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = 'from-benzene-get';
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

function startApp(): Promise<string> {
  const app = express();

  // Benzene owns POST /orders and GET /orders/:id; mounted before any body parser so it reads the raw body.
  app.use(benzene((pipeline) => useMessageHandlers(pipeline, CreateOrderHandler, GetOrderHandler)));

  // Legacy Express routes Benzene does not own - reached only via the strangler fallback.
  app.get('/legacy', (_req, res) => {
    res.status(200).json({ from: 'express' });
  });

  const server = app.listen(0);
  servers.push(server);
  return new Promise((resolve) =>
    server.on('listening', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

describe('Express strangler middleware', () => {
  it('Benzene handles a route it owns (POST /orders)', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: '42' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: 'ref-42' });
  });

  it('Benzene handles a GET route with a path parameter (GET /orders/:id)', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/orders/7`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ reference: 'from-benzene-get' });
  });

  it('falls through to Express for a route Benzene does not own (GET /legacy)', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/legacy`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ from: 'express' });
  });

  it('falls through to Express 404 for an entirely unknown route', async () => {
    const baseUrl = await startApp();

    const response = await fetch(`${baseUrl}/nothing-here`);

    expect(response.status).toBe(404); // Express's own not-found, not Benzene's
  });

  it('falls through on a matching path but a verb Benzene does not own (GET /orders)', async () => {
    const baseUrl = await startApp();

    // Benzene owns POST /orders, not GET /orders -> the strangler check misses -> Express handles it (404).
    const response = await fetch(`${baseUrl}/orders`);

    expect(response.status).toBe(404);
  });
});
