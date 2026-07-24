import { IHttpContext } from '@benzene/http';
import { ExpressRequestLike, ExpressResponseLike } from './types';

/** The buffered HTTP response, written to the real Express `res` in `ExpressResponseAdapter.finalizeAsync`. */
export interface ExpressResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * The middleware pipeline context for a single Express request/response - the Express analog of
 * `Benzene.AspNet.Core.AspNetContext` (`Benzene.AspNet.Core` isn't ported; ASP.NET Core is .NET-specific,
 * Express is the Node/JS host equivalent).
 *
 * Holds the raw request body (read up front by the middleware, mirroring ASP.NET's `UseBufferedRequestBody`
 * so the synchronous body getter serves it from memory) and a buffered {@link ExpressResponse} that
 * response handlers populate; it's written to the real `res` only in `finalizeAsync`. The status code
 * defaults to 404 as a safety net (the middleware only runs the pipeline for a matched route, so a handler
 * sets the real status).
 */
export class ExpressContext implements IHttpContext {
  readonly response: ExpressResponse = { statusCode: 404, headers: {}, body: '' };

  constructor(
    readonly req: ExpressRequestLike,
    readonly res: ExpressResponseLike,
    readonly rawBody: string,
  ) {}

  /** The uppercase HTTP method. */
  get method(): string {
    return (this.req.method ?? 'GET').toUpperCase();
  }

  /** The request path without query string (Express's `req.path`, or the URL's pathname as a fallback). */
  get path(): string {
    return this.req.path ?? new URL(this.req.url ?? '/', 'http://localhost').pathname;
  }

  /** The request headers, flattened to single string values (multi-value headers joined with ", "). */
  get headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.req.headers)) {
      if (value === undefined) {
        continue;
      }
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
    return headers;
  }

  /** The query-string parameters as a plain object. */
  get query(): Record<string, string> {
    const query: Record<string, string> = {};
    for (const [key, value] of new URL(this.req.url ?? '/', 'http://localhost').searchParams) {
      query[key] = value;
    }
    return query;
  }
}
