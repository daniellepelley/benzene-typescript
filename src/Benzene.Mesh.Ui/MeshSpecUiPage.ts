/** Port of Benzene.Mesh.Ui.MeshSpecUiPage. */
import { readFileSync } from 'node:fs';

/**
 * Provides the self-contained Benzene **mesh-hosted** Spec Explorer HTML page — a Swagger-UI-style viewer for a
 * single mesh service's Benzene spec, rendered by the mesh itself rather than by the service. It reads the verbatim
 * spec the aggregator already captured into the same-origin `services/{name}.json` snapshot (its `specJson` field),
 * so an individual service only ever has to serve its spec as JSON — it never has to host any HTML of its own. The
 * page has no external dependencies, so it can be served by any static file host, or by any Benzene transport.
 *
 * The page is opened with a `?service=<name>` query-string parameter (and, when the mesh UI was pointed at a
 * non-default manifest, a `?manifest=<url>` parameter naming where the artifacts live). A `?url=<specUrl>`
 * parameter is also honoured as a direct-spec fallback. The {@link MeshSpecUiPage.getHtml} overload injects a
 * `data-manifest-url` so a page opened with no query param still knows where the artifacts live.
 *
 * Divergence from the C# original (documented in the README "Porting conventions"): as with {@link MeshUiPage}, the
 * verbatim `mesh-spec-ui.html` product asset is read lazily/memoized from disk via `import.meta.url` rather than
 * embedded as an assembly resource.
 */
let cachedHtml: string | undefined;

function html(): string {
  if (cachedHtml === undefined) {
    cachedHtml = readFileSync(new URL('./mesh-spec-ui.html', import.meta.url), 'utf8');
  }
  return cachedHtml;
}

/** Escapes a string for safe use inside an HTML double-quoted attribute value (port of `WebUtility.HtmlEncode`). */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export const MeshSpecUiPage = {
  /**
   * The viewer HTML, optionally with a manifest URL injected as `data-manifest-url` on the document root, used as
   * the default artifact location when the page is opened without a `?manifest=` query parameter. A null/blank
   * `manifestUrl` returns the page unchanged. Mirrors the C# `GetHtml`/`GetHtml(manifestUrl)` pair.
   */
  getHtml(manifestUrl?: string): string {
    if (manifestUrl === undefined || manifestUrl.trim() === '') {
      return html();
    }
    return html().replace('<html lang="en">', `<html lang="en" data-manifest-url="${escapeAttribute(manifestUrl)}">`);
  },
} as const;
