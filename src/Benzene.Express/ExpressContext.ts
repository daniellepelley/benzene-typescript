import { IHttpContext } from '@benzenejs/http';
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
 *
 * Also carries the request's {@link signal} — the Express/Node analog of ASP.NET's
 * `HttpContext.RequestAborted` (the .NET R10 #104 rule): it aborts when the client disconnects
 * before the response is finished, so handlers, the BenzeneMessage envelope dispatch, and outbound
 * sends can stop work whose caller is gone.
 */
export class ExpressContext implements IHttpContext {
  readonly response: ExpressResponse = { statusCode: 404, headers: {}, body: '' };

  /**
   * Aborts when the inbound request's client goes away before the response completes. Wired off the
   * response's `close` event: Node emits it when the underlying connection closes, and a close with
   * the response not yet ended means the client disconnected mid-request.
   */
  readonly signal: AbortSignal;

  constructor(
    readonly req: ExpressRequestLike,
    readonly res: ExpressResponseLike,
    readonly rawBody: string,
  ) {
    const abortController = new AbortController();
    this.signal = abortController.signal;

    // Client-gone detection reads the RESPONSE side only: `req.destroyed` is not usable here, because
    // reading the request body with a `for await` (as the middleware's raw-body read does) destroys
    // the fully-consumed request stream — a normal, healthy request would look "gone".
    if (res.writableEnded !== true && res.destroyed === true) {
      // The connection was already gone before the context was built (e.g. the client hung up while
      // the body was being read).
      abortController.abort();
    } else if (typeof res.on === 'function') {
      // `typeof` guard: test hosts (e.g. the Google Cloud Functions test helper) satisfy the
      // structural response type with a minimal fake that has no event emitter — for those the
      // signal simply never aborts, exactly like a transport that can't observe the client.
      res.on('close', () => {
        if (res.writableEnded !== true) {
          abortController.abort();
        }
      });
    }
  }

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
