import { HttpRequest, IHttpRequestAdapter } from '@benzenejs/http';
import { ExpressContext } from './ExpressContext';

/**
 * Adapts an `ExpressContext` into Benzene's transport-agnostic `HttpRequest` (path, method, headers).
 * Express analog of `Benzene.AspNet.Core.AspNetHttpRequestAdapter`.
 */
export class ExpressHttpRequestAdapter implements IHttpRequestAdapter<ExpressContext> {
  map(context: ExpressContext): HttpRequest {
    const httpRequest = new HttpRequest();
    httpRequest.path = context.path;
    httpRequest.method = context.method;
    httpRequest.headers = context.headers;
    return httpRequest;
  }
}
