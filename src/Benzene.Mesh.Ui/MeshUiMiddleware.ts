/** Port of Benzene.Mesh.Ui.MeshUiMiddleware. */
import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzene/http';
import { MeshUiPage } from './MeshUiPage';

/**
 * Transport-agnostic HTTP middleware that serves the Benzene Mesh Explorer page. Works on any Benzene HTTP
 * transport because it drives the transport-neutral `IBenzeneResponseAdapter` directly rather than depending on any
 * one web framework.
 *
 * This is a secondary convenience (e.g. local demo/dev, or an aggregator host that self-serves its dashboard) — the
 * primary deployment target is a plain static file host serving `mesh-ui.html` alongside the aggregator's published
 * `manifest.json`/`services/*.json`, needing no Benzene pipeline at all. On a matching GET/HEAD request to the
 * configured path it writes the page as `text/html` and short-circuits; any other request passes to `next`. It sets
 * content-type/status/body then finalizes — deliberately bypassing the message-result path, whose body handler
 * forces `application/json` — matching `@benzene/spec-ui`'s `SpecUiMiddleware` exactly.
 *
 * The C# had two constructors (with/without `envelopeUrl`); the TS port collapses them into one with an optional
 * `envelopeUrl`.
 */
export class MeshUiMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  readonly name = 'MeshUi';

  private readonly path: string;
  private readonly html: string;

  constructor(
    path: string,
    manifestUrl: string,
    envelopeUrl: string | undefined,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
  ) {
    this.path = normalizePath(path);
    this.html = MeshUiPage.getHtml(manifestUrl, envelopeUrl);
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

/** Lower-cases and trims a path to a leading-slash, no-trailing-slash form for comparison. */
export function normalizePath(path: string | undefined): string {
  if (path === undefined || path.trim() === '') {
    return '/';
  }
  let trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    trimmed = '/' + trimmed;
  }
  if (trimmed.length > 1 && trimmed.endsWith('/')) {
    trimmed = trimmed.replace(/\/+$/, '');
  }
  return trimmed.toLowerCase();
}
