/** Port of Benzene.Spec.Ui.SpecUiPage. */

/**
 * The self-contained Benzene Spec Explorer page — a Swagger-UI-style viewer for the benzene message spec
 * (topics, request/response payloads, published events, and the validation rules carried in their JSON
 * Schemas). It fetches the spec from the URL injected as `data-spec-url` on the document root (see
 * {@link SpecUiPage.getHtml}) and resolves each `$ref` against the document's `components.schemas`.
 *
 * Divergence from the C# original (documented in the README "Porting conventions"): C# ships the page as an
 * **embedded assembly resource** read via reflection; a bundled Node/Lambda artifact can't rely on that, so
 * the port inlines the page as a string constant here. The page itself is a fresh, idiomatic viewer rather
 * than a transliteration of the 1300-line .NET HTML — same purpose (render the benzene spec), written the
 * way a TS developer would.
 */
const HTML = String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Benzene Spec Explorer</title>
  <style>
    :root {
      --bg:#f6f7f9; --panel:#fff; --ink:#1a1d21; --muted:#6b7280; --line:#e5e7eb; --accent:#4f46e5;
      --ok:#15803d; --ok-bg:#dcfce7; --warn:#92400e; --warn-bg:#fef3c7; --neutral:#374151; --neutral-bg:#eef2f7;
      --key:#4f46e5; --type:#0369a1;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg:#0e1116; --panel:#161b22; --ink:#e6edf3; --muted:#9198a1; --line:#2a313c; --accent:#a5b4fc;
        --ok:#4ade80; --ok-bg:#10331d; --warn:#fbbf24; --warn-bg:#3a2c08; --neutral:#cbd5e1; --neutral-bg:#1e242c;
        --key:#a5b4fc; --type:#7dd3fc;
      }
    }
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
    header{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:20px 24px;border-bottom:1px solid var(--line);background:var(--panel)}
    header h1{font-size:18px;margin:0;font-weight:650}
    header .sub{color:var(--muted);font-size:13px}
    header .spacer{flex:1}
    button{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer}
    button:hover{border-color:var(--accent)}
    main{max-width:960px;margin:0 auto;padding:24px}
    section{margin:0 0 32px}
    section>h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px}
    .chips{display:flex;gap:8px;flex-wrap:wrap}
    .chip{font-size:12px;color:var(--muted);background:var(--neutral-bg);border-radius:6px;padding:2px 9px}
    .badge{font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
    .badge.warn{color:var(--warn);background:var(--warn-bg)}
    .badge.method{color:var(--ok);background:var(--ok-bg);font-family:ui-monospace,monospace}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:12px}
    .card .topic{font-weight:600;font-size:15px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
    .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}
    .payload{margin-top:12px}
    .payload-label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:4px}
    .schema{font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;border-left:2px solid var(--line);padding-left:12px}
    .field{padding:1px 0}
    .field .k{color:var(--key);font-weight:600}
    .field .t{color:var(--type)}
    .field .req{color:var(--warn);font-weight:700}
    .field .c{color:var(--muted)}
    .nested{margin-left:16px}
    .muted{color:var(--muted)}
    .empty{padding:32px 24px;text-align:center;color:var(--muted)}
    .error{color:#b91c1c}
    code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
    a{color:var(--accent)}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Benzene <span class="muted">·</span> Spec Explorer</h1>
      <div class="sub" id="subtitle">Loading…</div>
    </div>
    <div class="spacer"></div>
    <button id="refresh" type="button">↻ Refresh</button>
  </header>
  <main>
    <section id="transports-section" hidden>
      <h2>Transports</h2>
      <div id="transports" class="chips"></div>
    </section>
    <section id="requests-section">
      <h2>Topics <span id="requests-count" class="muted"></span></h2>
      <div id="requests"></div>
    </section>
    <section id="events-section">
      <h2>Published events <span id="events-count" class="muted"></span></h2>
      <div id="events"></div>
    </section>
  </main>
  <script>
    var $ = function (id) { return document.getElementById(id); };
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

    // The URL the page fetches the spec from: ?url= wins, else the data-spec-url injected server-side.
    function specUrl() {
      var q = new URLSearchParams(location.search).get('url');
      if (q) return q;
      return document.documentElement.getAttribute('data-spec-url') || '';
    }

    // Resolve a { $ref: '#/components/schemas/X' } against the document's components, guarding cycles.
    function resolveRef(node, components, seen) {
      var guard = seen || {};
      while (node && typeof node === 'object' && typeof node.$ref === 'string') {
        var m = /^#\/components\/schemas\/(.+)$/.exec(node.$ref);
        if (!m || guard[m[1]]) return node;
        guard[m[1]] = true;
        node = (components || {})[m[1]];
      }
      return node;
    }

    function constraints(s) {
      var bits = [];
      if (s.format) bits.push(String(s.format));
      if (s.minLength != null) bits.push('min ' + s.minLength);
      if (s.maxLength != null) bits.push('max ' + s.maxLength);
      if (s.minimum != null) bits.push('≥ ' + s.minimum);
      if (s.maximum != null) bits.push('≤ ' + s.maximum);
      if (s.exclusiveMinimum != null) bits.push('> ' + s.exclusiveMinimum);
      if (s.exclusiveMaximum != null) bits.push('< ' + s.exclusiveMaximum);
      if (s.minItems != null) bits.push('min ' + s.minItems + ' items');
      if (s.maxItems != null) bits.push('max ' + s.maxItems + ' items');
      if (Array.isArray(s.enum)) bits.push('enum: ' + s.enum.join(' | '));
      return bits.length ? ' <span class="c">(' + esc(bits.join(', ')) + ')</span>' : '';
    }

    function typeName(s) {
      if (Array.isArray(s.enum)) return s.type || 'enum';
      if (s.type === 'array') { var it = s.items || {}; return 'array of ' + (it.type || 'object'); }
      return s.type || (s.properties ? 'object' : 'any');
    }

    // Render a schema (already ref-resolved at the top level) as an indented field list, depth-limited.
    function renderSchema(schema, components, depth) {
      var s = resolveRef(schema, components);
      if (!s || typeof s !== 'object') return '<span class="muted">—</span>';
      if (!s.properties) {
        // Non-object (or unconstrained): show the type line only.
        return '<div class="field"><span class="t">' + esc(typeName(s)) + '</span>' + constraints(s) + '</div>';
      }
      var required = {};
      (Array.isArray(s.required) ? s.required : []).forEach(function (r) { required[r] = true; });
      var d = depth || 0;
      return Object.keys(s.properties).map(function (name) {
        var p = resolveRef(s.properties[name], components);
        var opt = required[name] ? '<span class="req">*</span>' : '<span class="muted">?</span>';
        var line = '<div class="field"><span class="k">' + esc(name) + '</span>' + opt + ': <span class="t">' + esc(typeName(p)) + '</span>' + constraints(p) + '</div>';
        // One level of nesting for objects / array-of-object, to keep it readable.
        if (d < 4 && p && p.properties) {
          line += '<div class="nested">' + renderSchema(p, components, d + 1) + '</div>';
        } else if (d < 4 && p && p.type === 'array' && p.items && resolveRef(p.items, components).properties) {
          line += '<div class="nested">' + renderSchema(p.items, components, d + 1) + '</div>';
        }
        return line;
      }).join('');
    }

    function payload(label, schema, components) {
      if (schema === undefined) return '';
      return '<div class="payload"><div class="payload-label">' + label + '</div><div class="schema">' + renderSchema(schema, components, 0) + '</div></div>';
    }

    function isEmptySchema(s) { return !s || (typeof s === 'object' && Object.keys(s).length === 0); }

    function render(doc) {
      var components = (doc.components && doc.components.schemas) || {};

      var info = doc.info || {};
      $('subtitle').textContent = (info.title || 'service') + (info.version ? ' · v' + info.version : '');

      var transports = doc.transports || [];
      if (transports.length) {
        $('transports').innerHTML = transports.map(function (t) { return '<span class="chip">' + esc(t) + '</span>'; }).join('');
        $('transports-section').hidden = false;
      }

      // Requests (topics) — domain first, reserved utility topics last.
      var requests = (doc.requests || []).slice().sort(function (a, b) {
        return (a.reserved === b.reserved) ? String(a.topic).localeCompare(b.topic) : (a.reserved ? 1 : -1);
      });
      $('requests-count').textContent = requests.length ? '(' + requests.length + ')' : '';
      $('requests').innerHTML = requests.length ? requests.map(function (r) {
        var maps = (r.httpMappings || []).map(function (m) { return '<span class="badge method">' + esc(String(m.method).toUpperCase()) + ' ' + esc(m.path) + '</span>'; }).join(' ');
        var reserved = r.reserved ? '<span class="badge warn">reserved</span>' : '';
        var version = r.version ? '<span class="chip">v' + esc(r.version) + '</span>' : '';
        var badges = (maps || reserved || version) ? '<div class="row">' + version + reserved + maps + '</div>' : '';
        var req = isEmptySchema(resolveRef(r.request, components)) ? '' : payload('Request', r.request, components);
        var res = isEmptySchema(resolveRef(r.response, components)) ? '' : payload('Response', r.response, components);
        return '<div class="card"><div class="topic">' + esc(r.topic) + '</div>' + badges + req + res + '</div>';
      }).join('') : '<div class="empty">No topics.</div>';

      // Events (published).
      var events = doc.events || [];
      $('events-count').textContent = events.length ? '(' + events.length + ')' : '';
      if (events.length) {
        $('events').innerHTML = events.map(function (e) {
          var version = e.version ? '<div class="row"><span class="chip">v' + esc(e.version) + '</span></div>' : '';
          var msg = isEmptySchema(resolveRef(e.message, components)) ? '' : payload('Message', e.message, components);
          return '<div class="card"><div class="topic">' + esc(e.topic) + '</div>' + version + msg + '</div>';
        }).join('');
      } else {
        $('events-section').hidden = true;
      }
    }

    async function load() {
      var url = specUrl();
      if (!url) {
        $('subtitle').innerHTML = '<span class="error">No spec URL configured.</span> Add <code>?url=/spec?type=benzene</code>.';
        return;
      }
      $('subtitle').textContent = 'Loading …';
      try {
        var res = await fetch(url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        render(await res.json());
      } catch (err) {
        $('subtitle').innerHTML = '<span class="error">Failed to load the spec: ' + esc(err.message) + '</span>';
      }
    }

    $('refresh').addEventListener('click', load);
    load();
  </script>
</body>
</html>`;

/** Escapes a string for safe use inside an HTML double-quoted attribute value. */
function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
}

export const SpecUiPage = {
  /**
   * The viewer HTML, with `specUrl` injected as `data-spec-url` on the document root so the page fetches and
   * renders that spec on load. A null/blank `specUrl` returns the page unchanged (it then relies on a `?url=`
   * query parameter). Mirrors the C# `GetHtml`/`GetHtml(specUrl)` pair.
   */
  getHtml(specUrl?: string): string {
    if (specUrl === undefined || specUrl.trim() === '') {
      return HTML;
    }
    return HTML.replace('<html lang="en">', `<html lang="en" data-spec-url="${escapeAttribute(specUrl)}">`);
  },
} as const;
