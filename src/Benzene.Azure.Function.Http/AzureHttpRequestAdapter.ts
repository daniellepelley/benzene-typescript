import { HttpRequest, IHttpRequestAdapter } from '@benzene/http';
import { AzureHttpContext, azureHttpRequestPath } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetHttpRequestAdapter (the `AspNet` -> `AzureHttp` rename
 * collapses the doubled "Http" in `AspNetHttpRequestAdapter` to a single `AzureHttpRequestAdapter`).
 *
 * Adapts an `AzureHttpContext` into Benzene's transport-agnostic `HttpRequest` (path, method,
 * lower-cased headers).
 *
 * FIELD MAPPING: C# `HttpRequest.Path` -> `azureHttpRequestPath(httpRequest)` (parsed from
 * `httpRequest.url`); `HttpRequest.Method` -> `httpRequest.method`; `HttpRequest.Headers` (with keys
 * lower-cased) -> the fetch `Headers` object iterated via `forEach`.
 */
export class AzureHttpRequestAdapter implements IHttpRequestAdapter<AzureHttpContext> {
  map(context: AzureHttpContext): HttpRequest {
    const headers: Record<string, string> = {};
    context.httpRequest.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    const httpRequest = new HttpRequest();
    httpRequest.path = azureHttpRequestPath(context.httpRequest);
    httpRequest.method = context.httpRequest.method;
    httpRequest.headers = headers;
    return httpRequest;
  }
}
