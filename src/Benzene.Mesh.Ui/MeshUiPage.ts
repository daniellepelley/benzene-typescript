/** Port of Benzene.Mesh.Ui.MeshUiPage. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Provides the self-contained Benzene Mesh Explorer HTML page — a catalog viewer for a service mesh's
 * `manifest.json`/`services/{name}.json` artifacts (as published by `@benzenejs/mesh-aggregator`). The page has no
 * external dependencies, so it can be served by any static file host, or by any Benzene transport.
 *
 * The page loads a manifest from, in order of precedence: a `?url=` query-string parameter, the
 * `data-manifest-url` attribute on the document root (see {@link MeshUiPage.getHtml}), a relative fetch of
 * `manifest.json`, or an embedded sample. The primary deployment target is a plain static file host serving this
 * page alongside the aggregator's generated `manifest.json` — it does not require a Benzene pipeline at all.
 *
 * Divergence from the C# original (documented in the README "Porting conventions"): C# embeds the ~281KB
 * `mesh-ui.html` as an **assembly resource** read via reflection. This is the cross-language mesh product UI and
 * must stay byte-identical to the reference — its embedded client JS contains backticks and `${…}`, so it cannot
 * be a TS template literal (unlike `@benzenejs/spec-ui`, which inlines a freshly-rewritten page). Instead the file
 * is copied verbatim next to this module and read lazily/memoized from disk via `__dirname` — the port of
 * C#'s `Lazy<string>` + embedded-resource read.
 */
let cachedHtml: string | undefined;

function html(): string {
  if (cachedHtml === undefined) {
    cachedHtml = readFileSync(join(__dirname, 'mesh-ui.html'), 'utf8');
  }
  return cachedHtml;
}

/** Escapes a string for safe use inside an HTML double-quoted attribute value (port of `WebUtility.HtmlEncode`). */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export const MeshUiPage = {
  /**
   * The viewer HTML, optionally with a manifest URL and a live fleet-envelope endpoint injected onto the document
   * root. When `manifestUrl` is non-blank it is injected as `data-manifest-url` so the page fetches and renders
   * that manifest on load; when `envelopeUrl` is non-blank it is injected as `data-fleet-url` so the page's Fleet
   * plane enriches the catalog with live `mesh:query:*` data polled from that wire-envelope endpoint. Blank
   * (null/undefined/whitespace) values inject nothing; when both are blank the page is returned unchanged (it then
   * relies on a `?url=`/relative fetch). Mirrors the C# `GetHtml`/`GetHtml(manifestUrl)`/`GetHtml(manifestUrl,
   * envelopeUrl)` overloads.
   */
  getHtml(manifestUrl?: string, envelopeUrl?: string): string {
    let attribute = '';
    if (manifestUrl !== undefined && manifestUrl.trim() !== '') {
      attribute += ` data-manifest-url="${escapeAttribute(manifestUrl)}"`;
    }
    if (envelopeUrl !== undefined && envelopeUrl.trim() !== '') {
      attribute += ` data-fleet-url="${escapeAttribute(envelopeUrl)}"`;
    }
    if (attribute.length === 0) {
      return html();
    }
    return html().replace('<html lang="en">', `<html lang="en"${attribute}>`);
  },
} as const;
