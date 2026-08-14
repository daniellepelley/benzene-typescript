import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { IHttpContext } from '@benzenejs/http';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2Context.
 *
 * The middleware pipeline context for an API Gateway **HTTP API (payload format version 2.0)** request.
 * The v2 shape differs from v1 (`ApiGatewayContext`): the HTTP method and path live under
 * `requestContext.http`, headers are single-value, and cookies arrive as a dedicated `cookies` array
 * rather than a `Cookie` header. `method`/`path`/`combinedHeaders()` normalize those differences so the
 * shared `IHttpContext` pipeline sees them the same way it sees v1 requests.
 *
 * `@types/aws-lambda`: request `APIGatewayProxyEventV2`, response `APIGatewayProxyStructuredResultV2`
 * (`{ statusCode?, headers?, body?, cookies?, isBase64Encoded? }`), created lazily by
 * `ensureResponseExists`.
 */
export class ApiGatewayV2Context implements IHttpContext {
  constructor(apiGatewayProxyRequest: APIGatewayProxyEventV2) {
    this.apiGatewayProxyRequest = apiGatewayProxyRequest;
  }

  /** The raw API Gateway HTTP API v2 proxy request (the parsed Lambda event). */
  readonly apiGatewayProxyRequest: APIGatewayProxyEventV2;

  /** The v2 response to return, populated by response middleware; `undefined` until the first write. */
  apiGatewayProxyResponse?: APIGatewayProxyStructuredResultV2;

  /** The request's HTTP method (from `requestContext.http.method`), or `undefined` if absent. */
  get method(): string | undefined {
    return this.apiGatewayProxyRequest?.requestContext?.http?.method;
  }

  /** The request's path (from `requestContext.http.path`), or `undefined` if absent. */
  get path(): string | undefined {
    return this.apiGatewayProxyRequest?.requestContext?.http?.path;
  }

  /**
   * The request headers, folding the dedicated v2 `cookies` array into a single `cookie` header (unless
   * one is already present) so the shared HTTP pipeline sees cookies the same way it does on v1. Header
   * entries with an `undefined` value are dropped (C# `IDictionary<string,string>` has non-null values).
   */
  combinedHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.apiGatewayProxyRequest?.headers ?? {})) {
      if (value !== undefined) {
        headers[key] = value;
      }
    }

    const cookies = this.apiGatewayProxyRequest?.cookies;
    if (cookies !== undefined && cookies.length > 0 && !hasKeyInsensitive(headers, 'cookie')) {
      headers['cookie'] = cookies.join('; ');
    }

    return headers;
  }
}

function hasKeyInsensitive(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === lower);
}

/**
 * Ensures the context's v2 response object and its headers exist. Port of C#
 * `Extensions.EnsureResponseExists(ApiGatewayV2Context)`. Defined here (next to the context) to keep this
 * leaf module free of the response-adapter import cycle; re-exported from `Extensions.ts`.
 */
export function ensureV2ResponseExists(context: ApiGatewayV2Context): void {
  context.apiGatewayProxyResponse ??= { headers: {} };
  context.apiGatewayProxyResponse.headers ??= {};
}
