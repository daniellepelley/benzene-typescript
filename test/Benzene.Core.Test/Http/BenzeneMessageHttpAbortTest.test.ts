import { describe, expect, it } from 'vitest';
import {
  IServiceResolver,
  IServiceResolverFactory,
  ServiceIdentifier,
} from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter, ISetCurrentTransport } from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { FuncWrapperMiddleware, MiddlewarePipeline } from '@benzenejs/core-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  BenzeneMessageHttpMiddleware,
  BenzeneMessageHttpOptions,
  DefaultHttpStatusCodeMapper,
  HttpRequest,
  IHttpContext,
  IHttpRequestAdapter,
} from '@benzenejs/http';

/**
 * The abort-signal half of the BenzeneMessage-over-HTTP endpoint (the TS port of the .NET R17 #285
 * fix): the HTTP context's client-gone signal is threaded onto the dispatched envelope request so the
 * inner pipeline can observe it, and an abort mid-dispatch rejects the in-flight dispatch instead of
 * writing a response nobody will read.
 */

/** An HTTP context that carries the structural abort signal (as `ExpressContext` does). */
class AbortableHttpContext implements IHttpContext {
  constructor(readonly signal?: AbortSignal) {}
}

const fakeSetCurrentTransport: ISetCurrentTransport = { setTransport() {} };

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

class FakeServiceResolverFactory implements IServiceResolverFactory {
  createScope(): IServiceResolver {
    return new FakeScopeResolver();
  }
  dispose(): void {}
}

interface Harness {
  middleware: BenzeneMessageHttpMiddleware<AbortableHttpContext>;
  finalizeCount: () => number;
}

function createMiddleware(pipeline: MiddlewarePipeline<BenzeneMessageContext>): Harness {
  const requestAdapter: IHttpRequestAdapter<AbortableHttpContext> = {
    map: () => {
      const request = new HttpRequest();
      request.method = 'POST';
      request.path = '/benzene-message';
      request.headers = {};
      return request;
    },
  };
  const bodyGetter: IMessageBodyGetter<AbortableHttpContext> = {
    getBody: () => '{"topic":"example","headers":{},"body":"{}"}',
  };

  let finalizeCount = 0;
  const responseAdapter: IBenzeneResponseAdapter<AbortableHttpContext> = {
    setResponseHeader() {},
    setContentType() {},
    setStatusCode() {},
    setBody() {},
    getBody() {
      return '';
    },
    finalizeAsync() {
      finalizeCount += 1;
      return Promise.resolve();
    },
  };

  const middleware = new BenzeneMessageHttpMiddleware<AbortableHttpContext>(
    new BenzeneMessageHttpOptions(),
    pipeline,
    new FakeServiceResolverFactory(),
    requestAdapter,
    bodyGetter,
    responseAdapter,
    new DefaultHttpStatusCodeMapper(),
  );

  return { middleware, finalizeCount: () => finalizeCount };
}

describe('BenzeneMessageHttpMiddleware abort signal', () => {
  it('threads the HTTP context signal onto the dispatched envelope request', async () => {
    let observed: unknown = 'never-set';
    const pipeline = new MiddlewarePipeline<BenzeneMessageContext>([
      () =>
        new FuncWrapperMiddleware<BenzeneMessageContext>((context) => {
          observed = (context.benzeneMessageRequest as { signal?: unknown }).signal;
          context.benzeneMessageResponse.statusCode = BenzeneResultStatus.ok;
          context.benzeneMessageResponse.body = '{}';
          return Promise.resolve();
        }),
    ]);
    const h = createMiddleware(pipeline);
    const controller = new AbortController();

    await h.middleware.handleAsync(new AbortableHttpContext(controller.signal), () => Promise.resolve());

    // The exact same signal instance is what handlers/outbound sends observe.
    expect(observed).toBe(controller.signal);
    expect(h.finalizeCount()).toBe(1);
  });

  it('a context without a signal dispatches normally (signal stays undefined)', async () => {
    let observed: unknown = 'never-set';
    const pipeline = new MiddlewarePipeline<BenzeneMessageContext>([
      () =>
        new FuncWrapperMiddleware<BenzeneMessageContext>((context) => {
          observed = (context.benzeneMessageRequest as { signal?: unknown }).signal;
          context.benzeneMessageResponse.statusCode = BenzeneResultStatus.ok;
          context.benzeneMessageResponse.body = '{}';
          return Promise.resolve();
        }),
    ]);
    const h = createMiddleware(pipeline);

    await h.middleware.handleAsync(new AbortableHttpContext(undefined), () => Promise.resolve());

    expect(observed).toBeUndefined();
    expect(h.finalizeCount()).toBe(1);
  });

  it('aborting the inbound request rejects the in-flight dispatch and writes no response', async () => {
    // A handler that hangs until it observes the abort — the cooperative-cancellation shape.
    const pipeline = new MiddlewarePipeline<BenzeneMessageContext>([
      () =>
        new FuncWrapperMiddleware<BenzeneMessageContext>(
          (context) =>
            new Promise<void>((resolve) => {
              const signal = (context.benzeneMessageRequest as { signal?: AbortSignal }).signal!;
              signal.addEventListener('abort', () => resolve(), { once: true });
            }),
        ),
    ]);
    const h = createMiddleware(pipeline);
    const controller = new AbortController();

    const inFlight = h.middleware.handleAsync(new AbortableHttpContext(controller.signal), () =>
      Promise.resolve(),
    );

    controller.abort();

    // The dispatch is rejected with the signal's abort reason...
    await expect(inFlight).rejects.toMatchObject({ name: 'AbortError' });
    // ...and no response was written for the departed client.
    expect(h.finalizeCount()).toBe(0);
  });

  it('an already-aborted request never writes a response', async () => {
    const pipeline = new MiddlewarePipeline<BenzeneMessageContext>([
      () =>
        new FuncWrapperMiddleware<BenzeneMessageContext>((context) => {
          context.benzeneMessageResponse.statusCode = BenzeneResultStatus.ok;
          context.benzeneMessageResponse.body = '{}';
          return Promise.resolve();
        }),
    ]);
    const h = createMiddleware(pipeline);
    const controller = new AbortController();
    controller.abort();

    await expect(
      h.middleware.handleAsync(new AbortableHttpContext(controller.signal), () => Promise.resolve()),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.finalizeCount()).toBe(0);
  });
});
