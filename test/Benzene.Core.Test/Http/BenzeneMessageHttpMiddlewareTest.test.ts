import { describe, expect, it } from 'vitest';
import {
  IServiceResolver,
  IServiceResolverFactory,
  ServiceIdentifier,
} from '@benzene/abstractions';
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { ISetCurrentTransport } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipeline, FuncWrapperMiddleware } from '@benzene/core-middleware';
import { BenzeneMessageContext } from '@benzene/core-messages';
import { BenzeneResultStatus } from '@benzene/results';
import {
  BenzeneMessageHttpMiddleware,
  BenzeneMessageHttpOptions,
  DefaultHttpStatusCodeMapper,
  HttpRequest,
  IHttpContext,
  IHttpRequestAdapter,
} from '@benzene/http';

/**
 * Port of Benzene.Test.Http.BenzeneMessageHttpMiddlewareTest. The C# test drives the middleware over
 * Moq-built adapter interfaces; the TypeScript port uses plain fakes (structural typing needs no
 * dynamic proxy) and a real in-memory echo pipeline + a minimal fake resolver whose factory returns
 * itself — the direct analog of the C# `FakeServiceResolver`/`FakeServiceResolverFactory`.
 */

class FakeHttpContext implements IHttpContext {}

const fakeSetCurrentTransport: ISetCurrentTransport = { setTransport() {} };

// A minimal scope resolver providing only what the echo pipeline touches (ISetCurrentTransport, and
// an absent IMiddlewareFactory so the pipeline falls back to its default) — the analog of the C#
// `FakeServiceResolver`.
class FakeScopeResolver implements IServiceResolver {
  getService<T>(identifier: ServiceIdentifier<T>): T {
    if (identifier === ISetCurrentTransport) {
      return fakeSetCurrentTransport as unknown as T;
    }
    throw new Error(`No service registered for ${String(identifier)}`);
  }
  tryGetService<T>(): T | undefined {
    return undefined;
  }
  getServices<T>(): T[] {
    return [];
  }
  dispose(): void {}
}

// The inner factory the middleware dispatches the envelope pipeline through; its scope returns the
// fake resolver above (the analog of the C# `FakeServiceResolverFactory`).
class FakeServiceResolverFactory implements IServiceResolverFactory {
  createScope(): IServiceResolver {
    return new FakeScopeResolver();
  }
  dispose(): void {}
}

// The echo pipeline: sets the response envelope directly from the request topic, the direct port of
// the C# `CreateEchoPipeline`.
function createEchoPipeline(): MiddlewarePipeline<BenzeneMessageContext> {
  return new MiddlewarePipeline<BenzeneMessageContext>([
    () =>
      new FuncWrapperMiddleware<BenzeneMessageContext>((context) => {
        context.benzeneMessageResponse.statusCode = BenzeneResultStatus.ok;
        context.benzeneMessageResponse.body = `{"echoTopic":"${context.benzeneMessageRequest.topic}"}`;
        return Promise.resolve();
      }),
  ]);
}

interface Harness {
  middleware: BenzeneMessageHttpMiddleware<FakeHttpContext>;
  bodies: string[];
  statusCodes: string[];
  contentTypes: string[];
  finalizeCount: () => number;
}

function createMiddleware(
  method: string,
  requestPath: string,
  requestBody: string | undefined,
  options?: BenzeneMessageHttpOptions,
): Harness {
  const requestAdapter: IHttpRequestAdapter<FakeHttpContext> = {
    map: () => {
      const request = new HttpRequest();
      request.method = method;
      request.path = requestPath;
      request.headers = {};
      return request;
    },
  };

  const bodyGetter: IMessageBodyGetter<FakeHttpContext> = {
    getBody: () => requestBody,
  };

  const bodies: string[] = [];
  const statusCodes: string[] = [];
  const contentTypes: string[] = [];
  let finalizeCount = 0;

  const responseAdapter: IBenzeneResponseAdapter<FakeHttpContext> = {
    setResponseHeader() {},
    setContentType(_context, contentType) {
      contentTypes.push(contentType);
    },
    setStatusCode(_context, statusCode) {
      statusCodes.push(statusCode);
    },
    setBody(_context: FakeHttpContext, body: string | Uint8Array) {
      bodies.push(typeof body === 'string' ? body : new TextDecoder().decode(body));
    },
    getBody() {
      return '';
    },
    finalizeAsync() {
      finalizeCount += 1;
      return Promise.resolve();
    },
  };

  const middleware = new BenzeneMessageHttpMiddleware<FakeHttpContext>(
    options ?? new BenzeneMessageHttpOptions(),
    createEchoPipeline(),
    new FakeServiceResolverFactory(),
    requestAdapter,
    bodyGetter,
    responseAdapter,
    new DefaultHttpStatusCodeMapper(),
  );

  return { middleware, bodies, statusCodes, contentTypes, finalizeCount: () => finalizeCount };
}

const envelope = '{"topic":"example","headers":{},"body":"{}"}';

describe('BenzeneMessageHttpMiddleware', () => {
  it('POST to the matching path dispatches and short-circuits', async () => {
    const h = createMiddleware('POST', '/benzene-message', envelope);
    let nextCalled = false;

    await h.middleware.handleAsync(new FakeHttpContext(), () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(false);
    expect(h.statusCodes).toEqual(['200']);
    expect(h.contentTypes).toEqual(['application/json; charset=utf-8']);
    expect(h.finalizeCount()).toBe(1);
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]).toContain('"statusCode":"ok"');
    expect(h.bodies[0]).toContain('echoTopic');
  });

  it.each([
    ['GET', '/benzene-message'],
    ['PUT', '/benzene-message'],
    ['POST', '/something-else'],
  ])('non-matching request (%s %s) calls next instead', async (method, path) => {
    const h = createMiddleware(method, path, envelope);
    let nextCalled = false;

    await h.middleware.handleAsync(new FakeHttpContext(), () => {
      nextCalled = true;
      return Promise.resolve();
    });

    expect(nextCalled).toBe(true);
    expect(h.bodies).toHaveLength(0);
  });

  it.each([['not-json-at-all'], [undefined], [''], ['{"headers":{}}']])(
    'invalid or topicless envelope (%s) responds bad request',
    async (requestBody) => {
      const h = createMiddleware('POST', '/benzene-message', requestBody as string | undefined);

      await h.middleware.handleAsync(new FakeHttpContext(), () => Promise.resolve());

      expect(h.statusCodes).toEqual(['400']);
      expect(h.bodies).toHaveLength(1);
      expect(h.bodies[0]).toContain(BenzeneResultStatus.badRequest);
    },
  );

  it('topic rejected by the filter responds not found', async () => {
    const options = new BenzeneMessageHttpOptions();
    options.topicFilter = (topic) => topic !== 'example';
    const h = createMiddleware('POST', '/benzene-message', envelope, options);

    await h.middleware.handleAsync(new FakeHttpContext(), () => Promise.resolve());

    expect(h.statusCodes).toEqual(['404']);
    expect(h.bodies).toHaveLength(1);
    expect(h.bodies[0]).toContain(BenzeneResultStatus.notFound);
    expect(h.bodies[0]).not.toContain('echoTopic');
  });

  it.each([
    ['/benzene-message', 'benzene-message'],
    ['/benzene-message', '/BENZENE-MESSAGE'],
    ['/benzene-message', '/benzene-message/'],
    ['benzene-message', '/benzene-message'],
    ['/custom-path', '/custom-path'],
  ])(
    'path normalization matches regardless of case, trailing slash, or leading slash (%s vs %s)',
    async (configuredPath, requestPath) => {
      const options = new BenzeneMessageHttpOptions();
      options.path = configuredPath;
      const h = createMiddleware('POST', requestPath, envelope, options);
      let nextCalled = false;

      await h.middleware.handleAsync(new FakeHttpContext(), () => {
        nextCalled = true;
        return Promise.resolve();
      });

      expect(nextCalled).toBe(false);
      expect(h.finalizeCount()).toBe(1);
    },
  );
});
