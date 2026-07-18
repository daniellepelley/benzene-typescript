import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { ApiGatewayContext, ensureResponseExists } from './ApiGatewayContext';
import { Constants } from './Constants';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayResponseAdapter.
 *
 * Adapts Benzene's transport-agnostic response writing onto an `ApiGatewayContext`'s
 * `APIGatewayProxyResult` (statusCode, headers, body), creating the response lazily via
 * `ensureResponseExists` on first write.
 *
 * STATUS-STRING -> NUMERIC HTTP CODE: this adapter does NOT itself map Benzene statuses. As in C#
 * (`Convert.ToInt32(statusCode)`), `setStatusCode` receives an already-numeric HTTP code *string*
 * (e.g. `"200"`) and stores it as the numeric `APIGatewayProxyResult.statusCode` via `Number(...)`.
 * The Benzene-status(`"Ok"`/`"NotFound"`)-to-code(`"200"`/`"404"`) translation happens one step
 * upstream in `HttpStatusCodeResponseHandler` + `DefaultHttpStatusCodeMapper` (from `@benzene/http`),
 * which `addApiGateway` registers into the response-handler chain in place of the `BenzeneMessage`
 * transport's `DefaultResponseStatusHandler`.
 */
export class ApiGatewayResponseAdapter implements IBenzeneResponseAdapter<ApiGatewayContext> {
  setResponseHeader(context: ApiGatewayContext, headerKey: string, headerValue: string): void {
    ensureResponseExists(context);
    context.apiGatewayProxyResponse!.headers![headerKey] = headerValue;
  }

  setContentType(context: ApiGatewayContext, contentType: string): void {
    this.setResponseHeader(context, Constants.contentTypeHeader, contentType);
  }

  setStatusCode(context: ApiGatewayContext, statusCode: string): void {
    ensureResponseExists(context);
    context.apiGatewayProxyResponse!.statusCode = Number(statusCode);
  }

  setBody(context: ApiGatewayContext, body: string): void;
  setBody(context: ApiGatewayContext, body: Uint8Array): void;
  setBody(context: ApiGatewayContext, body: string | Uint8Array): void {
    ensureResponseExists(context);
    context.apiGatewayProxyResponse!.body =
      typeof body === 'string' ? body : new TextDecoder().decode(body);
  }

  getBody(context: ApiGatewayContext): string {
    ensureResponseExists(context);
    return context.apiGatewayProxyResponse!.body;
  }

  /** No-op for API Gateway: the response object is returned directly. Port of C# `FinalizeAsync`. */
  finalizeAsync(_context: ApiGatewayContext): Promise<void> {
    return Promise.resolve();
  }
}
