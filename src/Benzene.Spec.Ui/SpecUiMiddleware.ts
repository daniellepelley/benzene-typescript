/** Port of Benzene.Spec.Ui.SpecUiMiddleware. */
import { IBenzeneResponseAdapter } from '@benzenejs/abstractions-message-handlers';
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { IHttpContext, IHttpRequestAdapter } from '@benzenejs/http';
import { SpecUiPage } from './SpecUiPage';

/**
 * Transport-agnostic HTTP middleware that serves the Benzene Spec Explorer page. Works on any Benzene HTTP
 * transport (AWS Lambda API Gateway, Express, the self-host server, …) because it drives the transport-
 * neutral `IBenzeneResponseAdapter` directly rather than depending on a web framework.
 *
 * On a matching GET/HEAD request to the configured path it writes the page as `text/html` and short-circuits;
 * any other request passes to `next`. It sets content-type/status/body then finalizes — deliberately
 * bypassing the message-result path, whose body handler forces `application/json`.
 */
export class SpecUiMiddleware<TContext extends IHttpContext> implements IMiddleware<TContext> {
  readonly name = 'SpecUi';

  private readonly path: string;
  private readonly html: string;

  constructor(
    path: string,
    specUrl: string,
    private readonly httpRequestAdapter: IHttpRequestAdapter<TContext>,
    private readonly responseAdapter: IBenzeneResponseAdapter<TContext>,
  ) {
    this.path = normalizePath(path);
    this.html = SpecUiPage.getHtml(specUrl);
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
