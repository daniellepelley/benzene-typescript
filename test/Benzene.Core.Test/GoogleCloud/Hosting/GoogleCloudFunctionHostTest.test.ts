/**
 * Proves the one-liner boot `new GoogleCloudFunctionHost(StartUp).httpFunction` works from the UNIFIED
 * `BenzeneStartUp` — the SAME contract `AwsLambdaHost` / `AzureFunctionHost` boot from — with the Google
 * transport selected by `useGoogleCloud(app, g => useHttp(g, …))`. The Google counterpart of
 * `AwsLambdaHostTest` / `AzureFunctionHostTest`: a native `(req, res)` is built directly and driven through
 * the host, no live functions-framework server.
 *
 * (The pre-unification `HttpHostTest` covers the legacy `GoogleCloudFunctionStartUp` shape, which the host
 * still accepts; this file locks in the new unified shape.)
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import {
  BenzeneConfiguration,
  BenzeneStartUp,
  IBenzeneApplicationBuilder,
} from '@benzenejs/abstractions-middleware';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { addBenzene, MessageHandlersRegistry, message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import type { Request, Response } from '@google-cloud/functions-framework';
import { useGoogleCloud } from '@benzenejs/google-cloud-functions-core';
import { GoogleCloudFunctionHost, useHttp } from '@benzenejs/google-cloud-functions-http';

class Order {
  customerId?: string;
}
class OrderCreated {
  reference?: string;
}

const handled: string[] = [];
// A private registry so decorating this handler does not leak into the global registry.
const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.customerId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.customerId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// The composition root a real deployment ships — the canonical `BenzeneStartUp` shape, byte-for-byte the
// AWS/Azure one, with only the `useGoogleCloud` line differing.
class OrdersStartUp implements BenzeneStartUp {
  getConfiguration(): BenzeneConfiguration {
    return { get: (key) => process.env[key] };
  }

  configureServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder, _configuration: BenzeneConfiguration): void {
    useGoogleCloud(app, (g) => useHttp(g, (http) => useMessageHandlers(http, CreateOrderHandler)));
  }
}

interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function fakeRequest(method: string, url: string, body: string): Request {
  return {
    method,
    url,
    path: url.split('?')[0],
    headers: { 'content-type': 'application/json' },
    rawBody: Buffer.from(body, 'utf8'),
    body,
  } as unknown as Request;
}

function fakeResponse(): { res: Response; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 0, headers: {}, body: '' };
  const res = {
    set statusCode(value: number) {
      captured.statusCode = value;
    },
    get statusCode() {
      return captured.statusCode;
    },
    setHeader(key: string, value: string) {
      captured.headers[key] = value;
    },
    end(chunk?: string) {
      captured.body = chunk ?? '';
    },
  } as unknown as Response;
  return { res, captured };
}

describe('GoogleCloudFunctionHost (unified BenzeneStartUp boot)', () => {
  it('routes an HTTP request through httpFunction to the decorated handler', async () => {
    handled.length = 0;
    // The exact shape a deployment exports: `export const ordersFunction = new GoogleCloudFunctionHost(StartUp).httpFunction`.
    const handler = new GoogleCloudFunctionHost(OrdersStartUp).httpFunction;

    const req = fakeRequest('POST', '/orders', JSON.stringify({ customerId: 'acme' }));
    const { res, captured } = fakeResponse();

    await handler(req, res);

    expect(handled).toEqual(['acme']);
    expect(captured.statusCode).toBe(200);
    expect(JSON.parse(captured.body)).toEqual({ reference: 'ref-acme' });
  });

  it('httpFunction stays bound when detached', async () => {
    handled.length = 0;
    const host = new GoogleCloudFunctionHost(OrdersStartUp);
    const detached = host.httpFunction;

    const req = fakeRequest('POST', '/orders', JSON.stringify({ customerId: 'globex' }));
    const { res, captured } = fakeResponse();

    await detached(req, res);

    expect(handled).toEqual(['globex']);
    expect(captured.body).toContain('ref-globex');
  });

  it('throws when the unified startup selects the wrong transport verb (no HTTP pipeline)', () => {
    class NoHttpStartUp implements BenzeneStartUp {
      configureServices(services: IBenzeneServiceContainer): void {
        addBenzene(services);
      }
      // useGoogleCloud fires (platform matches) but never calls useHttp — the builder has no pipeline.
      configure(_app: IBenzeneApplicationBuilder): void {}
    }
    expect(() => new GoogleCloudFunctionHost(NoHttpStartUp)).toThrow('useHttp');
  });
});
