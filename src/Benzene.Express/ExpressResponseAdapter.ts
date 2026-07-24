import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { ExpressContext } from './ExpressContext';

const ContentTypeHeader = 'content-type';

/**
 * Adapts Benzene's transport-agnostic response writing onto an `ExpressContext`'s buffered response,
 * writing the buffered status/headers/body to the real Express `res` only in `finalizeAsync` (using
 * Node's `ServerResponse` API, so it works with Express or any Connect host).
 * Express analog of `Benzene.AspNet.Core.AspNetResponseAdapter`.
 *
 * STATUS-STRING -> NUMERIC CODE: `setStatusCode` receives an already-numeric HTTP code string (e.g. "200")
 * and stores it as a number; the Benzene-status -> code translation happens upstream in
 * `HttpStatusCodeResponseHandler` + `DefaultHttpStatusCodeMapper` (registered by `addExpress`).
 */
export class ExpressResponseAdapter implements IBenzeneResponseAdapter<ExpressContext> {
  setResponseHeader(context: ExpressContext, headerKey: string, headerValue: string): void {
    context.response.headers[headerKey] = headerValue;
  }

  setContentType(context: ExpressContext, contentType: string): void {
    this.setResponseHeader(context, ContentTypeHeader, contentType);
  }

  setStatusCode(context: ExpressContext, statusCode: string): void {
    context.response.statusCode = Number(statusCode);
  }

  setBody(context: ExpressContext, body: string): void;
  setBody(context: ExpressContext, body: Uint8Array): void;
  setBody(context: ExpressContext, body: string | Uint8Array): void {
    context.response.body = typeof body === 'string' ? body : new TextDecoder().decode(body);
  }

  getBody(context: ExpressContext): string {
    return context.response.body;
  }

  /** Writes the buffered status/headers/body to the real Express response. Port of C# `AspNetResponseAdapter.FinalizeAsync`. */
  finalizeAsync(context: ExpressContext): Promise<void> {
    const { res, response } = context;
    res.statusCode = response.statusCode;
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
    // No body on 204 No Content (the default status mapper maps Updated/Deleted -> 204); writing one is
    // invalid HTTP.
    res.end(response.statusCode === 204 ? undefined : response.body);
    return Promise.resolve();
  }
}
