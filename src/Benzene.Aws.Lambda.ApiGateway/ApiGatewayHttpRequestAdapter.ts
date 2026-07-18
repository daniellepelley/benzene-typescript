import { HttpRequest, IHttpRequestAdapter } from '@benzene/http';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayHttpRequestAdapter.
 *
 * Adapts an `ApiGatewayContext` into Benzene's transport-agnostic `HttpRequest` (path, method,
 * headers). .NET-PascalCase -> Node-camelCase: `apiGatewayProxyRequest.path` / `.httpMethod` /
 * `.headers`; header values typed `string | undefined` in `@types/aws-lambda` are filtered to the
 * `Record<string, string>` shape `HttpRequest.headers` expects.
 */
export class ApiGatewayHttpRequestAdapter implements IHttpRequestAdapter<ApiGatewayContext> {
  map(context: ApiGatewayContext): HttpRequest {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(context.apiGatewayProxyRequest.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }

    const httpRequest = new HttpRequest();
    httpRequest.path = context.apiGatewayProxyRequest.path;
    httpRequest.method = context.apiGatewayProxyRequest.httpMethod;
    httpRequest.headers = headers;
    return httpRequest;
  }
}
