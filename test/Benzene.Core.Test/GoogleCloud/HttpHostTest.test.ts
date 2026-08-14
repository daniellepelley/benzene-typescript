import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { addBenzene, MessageHandlersRegistry, message, useMessageHandlers } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import type { Request, Response } from '@google-cloud/functions-framework';
import {
  GoogleCloudFunctionApplicationBuilder,
  GoogleCloudFunctionHost,
  GoogleCloudFunctionStartUp,
  useHttp,
} from '@benzenejs/google-cloud-functions-http';

/**
 * Port of the C# GoogleCloudFunctionHostTest (test/Benzene.Core.Test/Hosting): the same startup that
 * hosts on any Benzene HTTP host also hosts on the Functions Framework HTTP trigger. Fakes only — a
 * (req, res) is built directly and driven through the host, no live functions-framework server. The
 * host bridges the Functions Framework's Express-style req/res through `@benzenejs/express`'s HTTP
 * pipeline (the ported ASP.NET Core analog).
 */

class Ping {
  name: string | undefined;
}

class Pong {
  message: string | undefined;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/ping')
@message('ping', { registry, requestType: Ping, responseType: Pong })
class PingHandler implements IMessageHandler<Ping, Pong> {
  handleAsync(request: Ping): Promise<IBenzeneResultOf<Pong>> {
    const payload = new Pong();
    payload.message = `pong-${request.name}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

class SharedStartUp implements GoogleCloudFunctionStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: GoogleCloudFunctionApplicationBuilder): void {
    useHttp(app, (http) => useMessageHandlers(http, PingHandler));
  }
}

/** A captured HTTP response written by the pipeline's response adapter. */
interface CapturedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** A minimal Functions Framework-shaped request over a raw body buffer. */
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

/** A minimal Functions Framework-shaped response that captures what the adapter writes. */
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

describe('GoogleCloudFunctionHost (end-to-end)', () => {
  it('runs the same shared startup that works on any Benzene HTTP host', async () => {
    const host = new GoogleCloudFunctionHost(SharedStartUp);

    const req = fakeRequest('POST', '/ping', JSON.stringify({ name: 'world' }));
    const { res, captured } = fakeResponse();

    await host.handleAsync(req, res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toContain('pong-world');
  });

  it('exposes an httpFunction closure bound to the host', async () => {
    const host = new GoogleCloudFunctionHost(SharedStartUp);
    const handler = host.httpFunction; // detach — must still work (bound)

    const req = fakeRequest('POST', '/ping', JSON.stringify({ name: 'bound' }));
    const { res, captured } = fakeResponse();

    await handler(req, res);

    expect(captured.body).toContain('pong-bound');
  });

  it('throws when the startup never calls useHttp', () => {
    class NoHttpStartUp implements GoogleCloudFunctionStartUp {
      configureServices(): void {}
      configure(): void {}
    }
    expect(() => new GoogleCloudFunctionHost(NoHttpStartUp)).toThrow('useHttp');
  });
});
