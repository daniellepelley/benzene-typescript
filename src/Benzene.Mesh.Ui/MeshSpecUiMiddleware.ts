/** Port of Benzene.Mesh.Ui.MeshSpecUiMiddleware. */
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import { MeshSpecUiPage } from './MeshSpecUiPage';
import { normalizePath } from './MeshUiMiddleware';

/**
 * Transport-agnostic HTTP middleware that serves the mesh-hosted Spec Explorer page ({@link MeshSpecUiPage}) — the
 * per-service spec view `mesh-ui.html` links to. Works on any Benzene HTTP transport because it drives the
 * transport-neutral `IBenzeneResponseAdapter` directly, exactly like {@link MeshUiMiddleware}.
 *
 * The default served path (`DefaultSpecUiPath`) ends in `.html` on purpose: `mesh-ui.html`'s per-service spec link
 * is the single relative link `mesh-spec-ui.html?service=…`, which must resolve the same whether the mesh UI is a
 * static file (next to the artifacts) or served from this pipeline (e.g. at `/mesh-ui`). Serving the page at
 * `/mesh-spec-ui.html` makes that link work in both worlds. On a matching GET/HEAD this writes the page as
 * `text/html` and short-circuits; any other request passes to `next`.
 */
export class MeshSpecUiMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  readonly name = 'MeshSpecUi';

  private readonly path: string;
  private readonly html: string;

  constructor(
    path: string,
    manifestUrl: string,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
  ) {
    this.path = normalizePath(path);
    this.html = MeshSpecUiPage.getHtml(manifestUrl);
  }

  async handleAsync(context: TContext, next: NextFunc): Promise<void> {
    const request = this.httpRequestAdapter.map(context);
    const method = request.method?.toLowerCase();

    if ((method === 'get' || method === 'head') && normalizePath(request.path) === this.path) {
      this.responseAdapter.setStatusCode(context, '200');
      this.responseAdapter.setContentType(context, 'text/html; charset=utf-8');
      this.responseAdapter.setBody(context, this.html);
      await this.responseAdapter.finalizeAsync(context);
      return;
    }

    await next();
  }
}
