import { describe, expect, it } from 'vitest';
import { IBenzeneClientContext, IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import {
  FetchLike,
  HttpClientMiddleware,
  HttpContextConverter,
  HttpSendMessageContext,
} from '@benzenejs/clients-http';

/**
 * The W1.3 abort-signal thread through the outbound HTTP client: `HttpSendMessageContext.signal` is
 * handed to the fetch call (so aborting it aborts the in-flight HTTP request), and the converter
 * propagates a signal the outer client context carries structurally.
 */

class CreateOrder {
  constructor(public readonly sku: string = 'widget') {}
}

function clientContext(signal?: AbortSignal): IBenzeneClientContext<CreateOrder, unknown> {
  const request: IBenzeneClientRequest<CreateOrder> = {
    topic: 'order:create',
    message: new CreateOrder(),
    headers: {},
  };
  const context = {
    request,
    response: undefined as unknown as IBenzeneResultOf<unknown>,
  } as IBenzeneClientContext<CreateOrder, unknown> & { signal?: AbortSignal };
  context.signal = signal;
  return context;
}

describe('outbound HTTP client abort signal', () => {
  it('HttpClientMiddleware passes the context signal to the fetch function', async () => {
    const controller = new AbortController();
    let captured: unknown = 'never-set';
    const fetchFn: FetchLike = (_request, signal) => {
      captured = signal;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const context = new HttpSendMessageContext(
      { url: 'http://svc/orders', method: 'POST', headers: {}, body: '{}' },
      controller.signal,
    );
    await new HttpClientMiddleware(fetchFn).handleAsync(context, () => Promise.resolve());

    expect(captured).toBe(controller.signal);
  });

  it('HttpClientMiddleware passes undefined when the context has no signal', async () => {
    let captured: unknown = 'never-set';
    const fetchFn: FetchLike = (_request, signal) => {
      captured = signal;
      return Promise.resolve(new Response('{}', { status: 200 }));
    };

    const context = new HttpSendMessageContext({
      url: 'http://svc/orders',
      method: 'POST',
      headers: {},
      body: '{}',
    });
    await new HttpClientMiddleware(fetchFn).handleAsync(context, () => Promise.resolve());

    expect(captured).toBeUndefined();
  });

  it('the default fetch aborts the in-flight HTTP call when the signal aborts', async () => {
    // An already-aborted signal makes the global fetch reject immediately with an AbortError —
    // proving the signal genuinely reaches `fetch(url, { signal })` without needing a live server.
    const controller = new AbortController();
    controller.abort();

    const context = new HttpSendMessageContext(
      { url: 'http://127.0.0.1:9/never', method: 'POST', headers: {}, body: '{}' },
      controller.signal,
    );

    await expect(
      new HttpClientMiddleware().handleAsync(context, () => Promise.resolve()),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('HttpContextConverter propagates a signal the outer client context carries', async () => {
    const controller = new AbortController();
    const converter = new HttpContextConverter<CreateOrder, unknown>('POST', 'http://svc/orders');

    const contextOut = await converter.createRequestAsync(clientContext(controller.signal));

    expect(contextOut.signal).toBe(controller.signal);
  });

  it('HttpContextConverter leaves the signal undefined when the outer context has none', async () => {
    const converter = new HttpContextConverter<CreateOrder, unknown>('POST', 'http://svc/orders');

    const contextOut = await converter.createRequestAsync(clientContext(undefined));

    expect(contextOut.signal).toBeUndefined();
  });
});
