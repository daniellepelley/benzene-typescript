import { describe, expect, it } from 'vitest';
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { HttpRequest, IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import { DefaultSpecUrl, normalizePath, SpecUiMiddleware, SpecUiPage } from '@benzene/spec-ui';

/**
 * Tests the ported Benzene.Spec.Ui: `SpecUiPage` (the inlined explorer HTML + `data-spec-url` injection) and
 * `SpecUiMiddleware` (serve the page on a matching GET/HEAD, otherwise pass through), driven through the
 * transport-neutral request/response adapters.
 */
class FakeContext implements IHttpContext {}

function requestAdapter(method: string, path: string): IHttpRequestAdapter<FakeContext> {
  return {
    map: () => {
      const request = new HttpRequest();
      request.method = method;
      request.path = path;
      return request;
    },
  };
}

function capturingResponse(): {
  captured: { status?: string; contentType?: string; body?: string; finalized: boolean };
  adapter: IBenzeneResponseAdapter<FakeContext>;
} {
  const captured: { status?: string; contentType?: string; body?: string; finalized: boolean } = { finalized: false };
  const adapter = {
    setStatusCode: (_c: FakeContext, s: string) => { captured.status = s; },
    setContentType: (_c: FakeContext, ct: string) => { captured.contentType = ct; },
    setBody: (_c: FakeContext, b: string | Uint8Array) => { captured.body = b as string; },
    finalizeAsync: () => { captured.finalized = true; return Promise.resolve(); },
  } as unknown as IBenzeneResponseAdapter<FakeContext>;
  return { captured, adapter };
}

function middleware(path: string, method: string, requestPath: string) {
  const { captured, adapter } = capturingResponse();
  const mw = new SpecUiMiddleware<FakeContext>(path, DefaultSpecUrl, requestAdapter(method, requestPath), adapter);
  let nextCalled = false;
  const run = () => mw.handleAsync(new FakeContext(), () => { nextCalled = true; return Promise.resolve(); });
  return { captured, run, wasNextCalled: () => nextCalled };
}

describe('SpecUiPage', () => {
  it('returns the explorer HTML with no data-spec-url by default', () => {
    const html = SpecUiPage.getHtml();
    expect(html).toContain('<title>Benzene Spec Explorer</title>');
    expect(html).toContain('<html lang="en">');
    // The attribute is not injected onto the <html> tag (the page then relies on a ?url= query param).
    expect(html).not.toContain('<html lang="en" data-spec-url');
  });

  it('injects the spec URL as data-spec-url on the document root', () => {
    const html = SpecUiPage.getHtml('/spec?type=benzene');
    expect(html).toContain('<html lang="en" data-spec-url="/spec?type=benzene">');
  });

  it('escapes the injected spec URL', () => {
    const html = SpecUiPage.getHtml('/spec?a="b"&c=<d>');
    expect(html).toContain('data-spec-url="/spec?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
  });
});

describe('SpecUiMiddleware', () => {
  it('serves the page for a GET to the configured path', async () => {
    const { captured, run, wasNextCalled } = middleware('/spec-ui', 'GET', '/spec-ui');
    await run();
    expect(captured.status).toBe('200');
    expect(captured.contentType).toBe('text/html; charset=utf-8');
    expect(captured.body).toContain('<title>Benzene Spec Explorer</title>');
    expect(captured.finalized).toBe(true);
    expect(wasNextCalled()).toBe(false);
  });

  it('serves a HEAD request too', async () => {
    const { captured, run } = middleware('/spec-ui', 'HEAD', '/spec-ui');
    await run();
    expect(captured.finalized).toBe(true);
  });

  it('passes non-matching paths through to next', async () => {
    const { captured, run, wasNextCalled } = middleware('/spec-ui', 'GET', '/orders');
    await run();
    expect(wasNextCalled()).toBe(true);
    expect(captured.finalized).toBe(false);
  });

  it('passes non-GET/HEAD methods through to next', async () => {
    const { run, wasNextCalled } = middleware('/spec-ui', 'POST', '/spec-ui');
    await run();
    expect(wasNextCalled()).toBe(true);
  });

  it('matches the path case-insensitively and ignoring a trailing slash', async () => {
    const { captured, run } = middleware('/Spec-UI/', 'get', '/spec-ui');
    await run();
    expect(captured.finalized).toBe(true);
  });
});

describe('normalizePath', () => {
  it('lower-cases, adds a leading slash, and drops a trailing slash', () => {
    expect(normalizePath('Spec-UI/')).toBe('/spec-ui');
    expect(normalizePath('/a/b/')).toBe('/a/b');
    expect(normalizePath(undefined)).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});
