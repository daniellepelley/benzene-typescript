import { HttpRequest, IHttpRequestAdapter } from '@benzenejs/http';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayHttpRequestAdapter.
 *
 * Adapts an `ApiGatewayContext` into Benzene's transport-agnostic `HttpRequest` (path, method,
 * headers), **lower-casing header names** (.NET R7-10 #89) — matching the Express adapter and the
 * v2 flow, so `authorization`/`origin`/`cookie` lookups by auth/CORS middleware (which read by
 * lowercase literal key) work on a v1-triggered request without every caller having to remember
 * `HttpRequest.asLowerCase()` first. API Gateway's raw v1 dictionary preserves original casing and
 * is case-sensitive, unlike every sibling transport adapter. Two header names that collide once
 * lower-cased (a malformed/duplicate wire payload) resolve first-wins rather than one clobbering
 * the other (.NET #105's `TryAdd` shape; JS objects are ordinal, so pre-lower-cased keys stand in
 * for .NET's `OrdinalIgnoreCase` dictionary contract).
 *
 * .NET-PascalCase -> Node-camelCase: `apiGatewayProxyRequest.path` / `.httpMethod` / `.headers`;
 * header values typed `string | undefined` in `@types/aws-lambda` are dropped when undefined.
 * `path`/`httpMethod` can be absent at runtime on a hand-built payload (health pings, authorizer
 * test invokes) and default to `''` — `HttpRequest` promises non-null strings.
 */
export class ApiGatewayHttpRequestAdapter implements IHttpRequestAdapter<ApiGatewayContext> {
  map(context: ApiGatewayContext): HttpRequest {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(context.apiGatewayProxyRequest.headers ?? {})) {
      const lowerKey = key.toLowerCase();
      if (value !== undefined && !(lowerKey in headers)) {
        headers[lowerKey] = value;
      }
    }

    const httpRequest = new HttpRequest();
    httpRequest.path = context.apiGatewayProxyRequest.path ?? '';
    httpRequest.method = context.apiGatewayProxyRequest.httpMethod ?? '';
    httpRequest.headers = headers;
    return httpRequest;
  }
}
