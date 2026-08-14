/**
 * Port of Benzene.Mesh.Ui — the Benzene Mesh Explorer: transport-agnostic HTTP middleware that serves two
 * self-contained HTML pages on any Benzene HTTP pipeline. `useMeshUi` serves the catalog/fleet viewer
 * (`mesh-ui.html`) for a mesh's `manifest.json`/`services/*.json` artifacts; `useMeshSpecUi` serves the per-service
 * spec viewer (`mesh-spec-ui.html`). Both pages are self-contained and the primary deployment target is actually a
 * plain static file host next to the aggregator's artifacts — the middleware is a secondary convenience.
 *
 * Divergence from `@benzenejs/spec-ui` (documented in the README "Porting conventions"): spec-ui inlines a
 * freshly-rewritten page as a `String.raw` TS constant. This package does **not**. The two mesh HTML files are the
 * cross-language mesh **product** UI and must stay byte-identical to the reference; `mesh-ui.html` is ~281KB and its
 * embedded client JS contains backticks and `${…}`, so it cannot be a TS template literal. Instead the files are
 * copied verbatim next to `MeshUiPage`/`MeshSpecUiPage` and read lazily/memoized from disk via `__dirname`
 * (`readFileSync(join(__dirname, 'mesh-ui.html'))`) — the port of C#'s `Lazy<string>` + embedded-assembly-resource
 * read.
 */
export * from './MeshUiPage';
export * from './MeshSpecUiPage';
export * from './MeshUiMiddleware';
export * from './MeshSpecUiMiddleware';
export * from './MeshUiExtensions';
