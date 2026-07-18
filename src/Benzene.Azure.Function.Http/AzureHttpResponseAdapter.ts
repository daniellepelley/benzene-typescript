import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { AzureHttpContext, ensureResponseExists } from './AzureHttpContext';

/** The `content-type` response header name. */
const contentTypeHeader = 'content-type';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetResponseAdapter.
 *
 * Adapts Benzene's transport-agnostic response writing onto an `AzureHttpContext`'s `HttpResponseInit`
 * (`status`, `headers`, `body`), creating the response lazily via `ensureResponseExists` on first write.
 *
 * FIELD MAPPING (.NET `ContentResult` -> `@azure/functions` `HttpResponseInit`):
 *   - `ContentResult.StatusCode` (`int`)   -> `response.status` (`number`)
 *   - `ContentResult.Content` (`string`)   -> `response.body` (`string`)
 *   - `ContentResult.ContentType`          -> a `content-type` response header (`HttpResponseInit` has
 *     no dedicated content-type property, so it is written as a header — this also matches the API
 *     Gateway adapter, which sets `content-type` as a header)
 *   - `HttpContext.Response.Headers.Add`   -> `response.headers[key] = value`
 *
 * STATUS-STRING -> NUMERIC HTTP CODE: as in C# (`Convert.ToInt32(statusCode)`), `setStatusCode`
 * receives an already-numeric HTTP code *string* (e.g. `"200"`) and stores it as the numeric
 * `response.status` via `Number(...)`. The Benzene-status(`"Ok"`/`"NotFound"`)-to-code(`"200"`/`"404"`)
 * translation happens one step upstream in `HttpStatusCodeResponseHandler` + `DefaultHttpStatusCodeMapper`
 * (from `@benzene/http`), which `addAzureHttp` registers into the response-handler chain in place of the
 * `BenzeneMessage` transport's `DefaultResponseStatusHandler`.
 */
export class AzureHttpResponseAdapter implements IBenzeneResponseAdapter<AzureHttpContext> {
  setResponseHeader(context: AzureHttpContext, headerKey: string, headerValue: string): void {
    ensureResponseExists(context);
    (context.response!.headers as Record<string, string>)[headerKey] = headerValue;
  }

  setContentType(context: AzureHttpContext, contentType: string): void {
    this.setResponseHeader(context, contentTypeHeader, contentType);
  }

  setStatusCode(context: AzureHttpContext, statusCode: string): void {
    ensureResponseExists(context);
    context.response!.status = Number(statusCode);
  }

  setBody(context: AzureHttpContext, body: string): void;
  setBody(context: AzureHttpContext, body: Uint8Array): void;
  setBody(context: AzureHttpContext, body: string | Uint8Array): void {
    ensureResponseExists(context);
    context.response!.body = typeof body === 'string' ? body : new TextDecoder().decode(body);
  }

  getBody(context: AzureHttpContext): string {
    ensureResponseExists(context);
    return (context.response!.body as string) ?? '';
  }

  /**
   * Finalizes the response. No-op; the `HttpResponseInit` is returned directly from the entry point
   * application. Port of C# `FinalizeAsync` (`Task.CompletedTask`).
   */
  finalizeAsync(_context: AzureHttpContext): Promise<void> {
    return Promise.resolve();
  }
}
