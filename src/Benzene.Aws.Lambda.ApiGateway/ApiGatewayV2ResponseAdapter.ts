import { IBenzeneResponseAdapter } from '@benzene/abstractions-message-handlers';
import { ApiGatewayV2Context, ensureV2ResponseExists } from './ApiGatewayV2Context';
import { Constants } from './Constants';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2ResponseAdapter.
 *
 * Adapts Benzene's transport-agnostic response writing onto an `ApiGatewayV2Context`'s
 * `APIGatewayProxyStructuredResultV2`. Two v2-specific behaviors vs v1: a `set-cookie` header is appended
 * to the dedicated `cookies` array (the v2 wire format carries cookies there, not in the header map), and
 * a raw binary body is base64-encoded with `isBase64Encoded` set so API Gateway decodes it back to bytes.
 * As in v1, `setStatusCode` receives an already-numeric HTTP code string (the Benzene-status→code mapping
 * happens upstream in `HttpStatusCodeResponseHandler`).
 */
export class ApiGatewayV2ResponseAdapter implements IBenzeneResponseAdapter<ApiGatewayV2Context> {
  setResponseHeader(context: ApiGatewayV2Context, headerKey: string, headerValue: string): void {
    ensureV2ResponseExists(context);

    if (headerKey.toLowerCase() === 'set-cookie') {
      const response = context.apiGatewayProxyResponse!;
      response.cookies =
        response.cookies !== undefined && response.cookies.length > 0
          ? [...response.cookies, headerValue]
          : [headerValue];
      return;
    }

    context.apiGatewayProxyResponse!.headers![headerKey] = headerValue;
  }

  setContentType(context: ApiGatewayV2Context, contentType: string): void {
    this.setResponseHeader(context, Constants.contentTypeHeader, contentType);
  }

  setStatusCode(context: ApiGatewayV2Context, statusCode: string): void {
    ensureV2ResponseExists(context);
    context.apiGatewayProxyResponse!.statusCode = Number(statusCode);
  }

  setBody(context: ApiGatewayV2Context, body: string): void;
  setBody(context: ApiGatewayV2Context, body: Uint8Array): void;
  setBody(context: ApiGatewayV2Context, body: string | Uint8Array): void {
    ensureV2ResponseExists(context);
    if (typeof body === 'string') {
      context.apiGatewayProxyResponse!.body = body;
      return;
    }
    // Raw bytes: base64-encode and flag so API Gateway decodes back to binary on the way out.
    context.apiGatewayProxyResponse!.body = Buffer.from(body).toString('base64');
    context.apiGatewayProxyResponse!.isBase64Encoded = true;
  }

  getBody(context: ApiGatewayV2Context): string {
    ensureV2ResponseExists(context);
    return context.apiGatewayProxyResponse!.body ?? '';
  }

  /** No-op for API Gateway: the response object is returned directly. Port of C# `FinalizeAsync`. */
  finalizeAsync(_context: ApiGatewayV2Context): Promise<void> {
    return Promise.resolve();
  }
}
