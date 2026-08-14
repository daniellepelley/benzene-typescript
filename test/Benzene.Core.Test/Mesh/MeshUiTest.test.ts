import { describe, expect, it } from 'vitest';
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { HttpRequest, IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import {
  DefaultManifestUrl,
  DefaultPath,
  DefaultSpecUiPath,
  MeshSpecUiMiddleware,
  MeshSpecUiPage,
  MeshUiMiddleware,
  MeshUiPage,
  normalizePath,
} from '@benzene/mesh-ui';

/**
 * Tests the ported Benzene.Mesh.Ui: the two pages (`MeshUiPage`/`MeshSpecUiPage` — the verbatim product HTML read
 * from disk + `data-manifest-url`/`data-fleet-url` injection) and the two middlewares (serve the page on a matching
 * GET/HEAD, otherwise pass through), driven through the transport-neutral request/response adapters.
 */
const MeshUiTitle = '<title>Benzene Mesh</title>';
const MeshSpecUiTitle = '<title>Benzene Service Spec</title>';

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

function meshUiMiddleware(path: string, method: string, requestPath: string) {
  const { captured, adapter } = capturingResponse();
  const mw = new MeshUiMiddleware<FakeContext>(path, DefaultManifestUrl, undefined, requestAdapter(method, requestPath), adapter);
  let nextCalled = false;
  const run = () => mw.handleAsync(new FakeContext(), () => { nextCalled = true; return Promise.resolve(); });
  return { captured, run, wasNextCalled: () => nextCalled };
}

function meshSpecUiMiddleware(path: string, method: string, requestPath: string) {
  const { captured, adapter } = capturingResponse();
  const mw = new MeshSpecUiMiddleware<FakeContext>(path, DefaultManifestUrl, requestAdapter(method, requestPath), adapter);
  let nextCalled = false;
  const run = () => mw.handleAsync(new FakeContext(), () => { nextCalled = true; return Promise.resolve(); });
  return { captured, run, wasNextCalled: () => nextCalled };
}

describe('MeshUiPage', () => {
  it('returns the explorer HTML with no injected attribute by default', () => {
    const html = MeshUiPage.getHtml();
    expect(html).toContain(MeshUiTitle);
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('data-manifest-url="');
    expect(html).not.toContain('data-fleet-url="');
  });

  it('injects the manifest URL as data-manifest-url on the document root', () => {
    const html = MeshUiPage.getHtml('manifest.json');
    expect(html).toContain('<html lang="en" data-manifest-url="manifest.json">');
    expect(html).not.toContain('data-fleet-url="');
  });

  it('injects both data-manifest-url and data-fleet-url when an envelope URL is given', () => {
    const html = MeshUiPage.getHtml('manifest.json', '/benzene/invoke');
    expect(html).toContain('<html lang="en" data-manifest-url="manifest.json" data-fleet-url="/benzene/invoke">');
  });

  it('escapes the injected attribute values', () => {
    const html = MeshUiPage.getHtml('/m?a="b"&c=<d>');
    expect(html).toContain('data-manifest-url="/m?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
  });

  it('injects nothing for a whitespace-only manifest URL', () => {
    const html = MeshUiPage.getHtml('   ');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('data-manifest-url="');
  });
});

describe('MeshSpecUiPage', () => {
  it('returns the spec viewer HTML with no injected attribute by default', () => {
    const html = MeshSpecUiPage.getHtml();
    expect(html).toContain(MeshSpecUiTitle);
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('data-manifest-url="');
  });

  it('injects the manifest URL as data-manifest-url on the document root', () => {
    const html = MeshSpecUiPage.getHtml('manifest.json');
    expect(html).toContain('<html lang="en" data-manifest-url="manifest.json">');
  });

  it('escapes the injected manifest URL', () => {
    const html = MeshSpecUiPage.getHtml('/m?a="b"&c=<d>');
    expect(html).toContain('data-manifest-url="/m?a=&quot;b&quot;&amp;c=&lt;d&gt;"');
  });

  it('injects nothing for a whitespace-only manifest URL', () => {
    const html = MeshSpecUiPage.getHtml('   ');
    expect(html).toContain('<html lang="en">');
    expect(html).not.toContain('data-manifest-url="');
  });
});

describe('MeshUiMiddleware', () => {
  it('serves the page for a GET to the configured path', async () => {
    const { captured, run, wasNextCalled } = meshUiMiddleware(DefaultPath, 'GET', DefaultPath);
    await run();
    expect(captured.status).toBe('200');
    expect(captured.contentType).toBe('text/html; charset=utf-8');
    expect(captured.body).toContain(MeshUiTitle);
    expect(captured.finalized).toBe(true);
    expect(wasNextCalled()).toBe(false);
  });

  it('serves a HEAD request too', async () => {
    const { captured, run } = meshUiMiddleware(DefaultPath, 'HEAD', DefaultPath);
    await run();
    expect(captured.finalized).toBe(true);
  });

  it('passes non-matching paths through to next', async () => {
    const { captured, run, wasNextCalled } = meshUiMiddleware(DefaultPath, 'GET', '/orders');
    await run();
    expect(wasNextCalled()).toBe(true);
    expect(captured.finalized).toBe(false);
  });

  it('passes non-GET/HEAD methods through to next', async () => {
    const { captured, run, wasNextCalled } = meshUiMiddleware(DefaultPath, 'POST', DefaultPath);
    await run();
    expect(wasNextCalled()).toBe(true);
    expect(captured.finalized).toBe(false);
  });
});

describe('MeshSpecUiMiddleware', () => {
  it('serves the page for a GET to the configured path', async () => {
    const { captured, run, wasNextCalled } = meshSpecUiMiddleware(DefaultSpecUiPath, 'GET', DefaultSpecUiPath);
    await run();
    expect(captured.status).toBe('200');
    expect(captured.contentType).toBe('text/html; charset=utf-8');
    expect(captured.body).toContain(MeshSpecUiTitle);
    expect(captured.finalized).toBe(true);
    expect(wasNextCalled()).toBe(false);
  });

  it('serves a HEAD request too', async () => {
    const { captured, run } = meshSpecUiMiddleware(DefaultSpecUiPath, 'HEAD', DefaultSpecUiPath);
    await run();
    expect(captured.finalized).toBe(true);
  });

  it('passes non-matching paths through to next', async () => {
    const { captured, run, wasNextCalled } = meshSpecUiMiddleware(DefaultSpecUiPath, 'GET', '/orders');
    await run();
    expect(wasNextCalled()).toBe(true);
    expect(captured.finalized).toBe(false);
  });

  it('passes non-GET/HEAD methods through to next', async () => {
    const { captured, run, wasNextCalled } = meshSpecUiMiddleware(DefaultSpecUiPath, 'POST', DefaultSpecUiPath);
    await run();
    expect(wasNextCalled()).toBe(true);
    expect(captured.finalized).toBe(false);
  });
});

describe('normalizePath', () => {
  it('lower-cases, adds a leading slash, and drops a trailing slash', () => {
    expect(normalizePath('Mesh-UI/')).toBe('/mesh-ui');
    expect(normalizePath('/a/b/')).toBe('/a/b');
    expect(normalizePath(undefined)).toBe('/');
    expect(normalizePath('')).toBe('/');
  });
});
