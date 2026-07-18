import { HttpRequest, HttpResponseInit } from '@azure/functions';
import { IHttpContext } from '@benzene/http';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetContext.
 *
 * ASP.NET -> @azure/functions ADAPTATION: the .NET package is named "AspNet" because Azure Functions
 * HTTP historically ran through ASP.NET Core (`Microsoft.AspNetCore.Http.HttpRequest` in, an
 * `IActionResult`/`ContentResult` out). Node has no ASP.NET; the ecosystem-native model is the
 * `@azure/functions` v4 HTTP programming model, so every `AspNet*` type is renamed `AzureHttp*` and
 * retargeted onto `@azure/functions`' `HttpRequest` (request) and `HttpResponseInit` (response).
 *
 * FIELD MAPPING (.NET ASP.NET -> @azure/functions):
 *   - `HttpRequest.Method` / `.Path`            -> `httpRequest.method` / `azureHttpRequestPath(...)`
 *     (`@azure/functions`' `HttpRequest.url` is the full URL, so the path is parsed out of it)
 *   - `HttpRequest.Headers` (`IHeaderDictionary`) -> `httpRequest.headers` (a fetch-`Headers` object)
 *   - request body stream (read synchronously in .NET via a blocking `StreamReader`) -> a
 *     pre-materialized `body` string (see below)
 *   - `ContentResult` (`StatusCode`/`Content`/`ContentType`/response headers) -> a mutable
 *     `HttpResponseInit` (`status`/`body`/`headers`)
 *
 * ASYNC-BODY vs SYNC-GETTER: `@azure/functions`' `HttpRequest.text()`/`.json()` are asynchronous,
 * but Benzene's `IMessageBodyGetter.getBody(context): string | undefined` is synchronous (matching
 * the .NET port). The body is therefore read EAGERLY at the entry point (`handleHttpRequest`
 * `await request.text()`) and passed to this context, where `AzureHttpMessageBodyGetter` reads the
 * already-materialized `body` field synchronously. This mirrors .NET, whose `AspNetMessageBodyGetter`
 * blocks on `ReadToEndAsync().Result` to stay synchronous.
 */
export class AzureHttpContext implements IHttpContext {
  /**
   * @param httpRequest The incoming `@azure/functions` HTTP request supplied by the Functions host.
   * @param body The request body, read eagerly at the entry point (the sync body getter reads this).
   */
  constructor(httpRequest: HttpRequest, body?: string) {
    this.httpRequest = httpRequest;
    this.body = body;
  }

  /** The incoming `@azure/functions` HTTP request. */
  readonly httpRequest: HttpRequest;

  /**
   * The request body, materialized once at the entry point. Undefined (C# `null`) if no body was read.
   * Port of the value `AspNetMessageBodyGetter` obtains by reading the ASP.NET body stream.
   */
  readonly body: string | undefined;

  /**
   * The response being built toward the returned `HttpResponseInit`. Set by
   * `AzureHttpResponseAdapter`; created lazily via `ensureResponseExists` (the port of C#
   * `Extensions.EnsureResponseExists`, which lazily creates the `ContentResult`).
   */
  response?: HttpResponseInit;
}

/**
 * Extracts the URL path from an `@azure/functions` `HttpRequest`. Port of the .NET `HttpRequest.Path`
 * access: ASP.NET exposes the path directly, whereas `@azure/functions` exposes the full `url`, so the
 * path is parsed out of it (query string dropped, exactly as C# `HttpRequest.Path` excludes it).
 */
export function azureHttpRequestPath(httpRequest: HttpRequest): string {
  return new URL(httpRequest.url).pathname;
}

/**
 * Ensures the context's response object and its headers exist. Port of C#
 * `Extensions.EnsureResponseExists` — placed here (next to the context it initializes) rather than in
 * `Extensions.ts` to keep this leaf module free of the response-adapter import cycle; it is
 * re-exported from `Extensions.ts` so the public API location still matches C#.
 *
 * `HttpResponseInit.status` defaults to `0` (overwritten by `HttpStatusCodeResponseHandler`), `body`
 * to `''`, and `headers` to an empty `Record<string, string>` — the mutable header shape the response
 * adapter writes into (`HttpHeadersInit` also permits a `Headers` object or tuple array, but a plain
 * record is the simplest to mutate incrementally).
 */
export function ensureResponseExists(context: AzureHttpContext): void {
  context.response ??= { status: 0, headers: {}, body: '' };
  context.response.headers ??= {};
}
