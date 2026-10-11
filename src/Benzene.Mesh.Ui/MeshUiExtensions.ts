/** Port of Benzene.Mesh.Ui.MeshUiExtensions. */
import { ServiceIdentifier } from '@benzenejs/abstractions';
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, IMiddlewarePipelineBuilder } from '@benzenejs/abstractions-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzenejs/http';
import { MeshUiMiddleware } from './MeshUiMiddleware';
import { MeshSpecUiMiddleware } from './MeshSpecUiMiddleware';

/**
 * The default path the mesh UI is served from: `/benzene/mesh-ui`, the well-known framework surface
 * (design-principles §5.2). Pass `path` to serve it elsewhere.
 */
export const DefaultPath = '/benzene/mesh-ui';

/**
 * The default URL the UI fetches `manifest.json` from — a relative path, since the realistic case is the HTML
 * sitting in the same directory as the aggregator's generated artifacts (unlike `@benzenejs/spec-ui`'s default, which
 * points at a route on the same live service).
 */
export const DefaultManifestUrl = 'manifest.json';

/**
 * The default path the mesh-hosted Spec Explorer is served from. It ends in `.html` so the single relative link
 * `mesh-ui.html` builds (`mesh-spec-ui.html?service=…`) resolves correctly whether the mesh UI is a static file
 * next to the artifacts or served from this pipeline at `/benzene/mesh-ui`.
 */
export const DefaultSpecUiPath = '/mesh-spec-ui.html';

/**
 * The default wire-envelope endpoint the mesh UI's live Fleet plane polls, following the default service standard's
 * `/benzene/` prefix. Pass it as `useMeshUi`'s `envelopeUrl` on a mesh host that also serves a
 * `@benzenejs/mesh-collector` over the wire envelope.
 */
export const DefaultEnvelopeUrl = '/benzene/invoke';

/**
 * Serves the Benzene Mesh Explorer page at `path` on any HTTP pipeline — a catalog viewer for a service mesh's
 * generated `manifest.json`/`services/*.json` artifacts. This is a secondary convenience; the primary deployment
 * target is a plain static file host serving `mesh-ui.html` alongside the aggregator's published artifacts, needing
 * no Benzene pipeline at all. When `envelopeUrl` is set (e.g. {@link DefaultEnvelopeUrl}), the catalog is enriched
 * with live health, observed consumers, and recent flows from the page's Fleet plane. Add this before the
 * message-handler middleware. C# extension method → free function taking the pipeline builder first.
 */
export function useMeshUi<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  path: string = DefaultPath,
  manifestUrl: string = DefaultManifestUrl,
  envelopeUrl?: string,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => {
    // Scoped, not singleton: the middleware holds the transport's scoped request/response adapters, which a
    // singleton would capture for the app's lifetime (the DI captive-dependency warning). The page itself
    // is memoized, so per-invocation construction is cheap.
    container.addScopedFactory(
      MeshUiMiddleware,
      (resolver) =>
        new MeshUiMiddleware<TContext>(
          path,
          manifestUrl,
          envelopeUrl,
          resolver.getService(IHttpRequestAdapter) as IHttpRequestAdapter<TContext>,
          resolver.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<TContext>,
        ),
    );
  });
  return app.useService(MeshUiMiddleware as unknown as ServiceIdentifier<IMiddleware<TContext>>);
}

/**
 * Serves the mesh-hosted Spec Explorer page ({@link MeshSpecUiMiddleware}) at `path` — the per-service spec view
 * `mesh-ui.html`'s spec link opens. It renders the verbatim spec the aggregator captured into the same-origin
 * `services/{name}.json` snapshot, so a mesh service only ever serves JSON, never HTML. Pair it with
 * {@link useMeshUi} (and the artifact-serving middleware) on the same pipeline. Like `useMeshUi` this is a secondary
 * convenience — a static file host serving `mesh-spec-ui.html` alongside the artifacts needs no Benzene pipeline.
 */
export function useMeshSpecUi<TContext extends IHttpContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  path: string = DefaultSpecUiPath,
  manifestUrl: string = DefaultManifestUrl,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((container) => {
    // Scoped, for the same reason as `useMeshUi`.
    container.addScopedFactory(
      MeshSpecUiMiddleware,
      (resolver) =>
        new MeshSpecUiMiddleware<TContext>(
          path,
          manifestUrl,
          resolver.getService(IHttpRequestAdapter) as IHttpRequestAdapter<TContext>,
          resolver.getService(IBenzeneResponseAdapter) as IBenzeneResponseAdapter<TContext>,
        ),
    );
  });
  return app.useService(MeshSpecUiMiddleware as unknown as ServiceIdentifier<IMiddleware<TContext>>);
}
