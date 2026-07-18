import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IHttpContext } from '@benzene/http';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayContext.
 *
 * The middleware pipeline context for a single API Gateway HTTP request/response.
 *
 * .NET-PascalCase -> Node-camelCase mapping: the .NET types are
 * `Amazon.Lambda.APIGatewayEvents.APIGatewayProxyRequest` (request) and `APIGatewayProxyResponse`
 * (response). Their `@types/aws-lambda` equivalents are `APIGatewayProxyEvent` (request) and
 * `APIGatewayProxyResult` (response), whose fields are camelCase: request `httpMethod`, `path`,
 * `headers`, `body`, `queryStringParameters`, `pathParameters`, `requestContext`; response
 * `{ statusCode: number, headers?, body: string }`.
 *
 * Unlike the .NET response type (a mutable object whose `StatusCode`/`Body`/`Headers` default to
 * `0`/`null`/`null`), `APIGatewayProxyResult` requires `statusCode: number` and `body: string`, so
 * `apiGatewayProxyResponse` starts `undefined` and is created lazily by `ensureResponseExists` with
 * safe defaults (`{ statusCode: 0, headers: {}, body: '' }`) that response handlers then overwrite.
 */
export class ApiGatewayContext implements IHttpContext {
  constructor(apiGatewayProxyRequest: APIGatewayProxyEvent) {
    this.apiGatewayProxyRequest = apiGatewayProxyRequest;
  }

  /** The raw API Gateway proxy request (the parsed Lambda event). */
  readonly apiGatewayProxyRequest: APIGatewayProxyEvent;

  /**
   * The API Gateway proxy response to return, populated by response middleware as the pipeline runs.
   * `undefined` until the first write; use `ensureResponseExists` to initialize it lazily.
   */
  apiGatewayProxyResponse?: APIGatewayProxyResult;
}

/**
 * Ensures the context's response object and its headers exist. Port of C#
 * `Extensions.EnsureResponseExists` — placed here (next to the context it initializes) rather than in
 * `Extensions.ts` to keep this leaf module free of the DI/response-adapter import cycle; it is
 * re-exported from `Extensions.ts` so the public API location still matches C#.
 */
export function ensureResponseExists(context: ApiGatewayContext): void {
  context.apiGatewayProxyResponse ??= { statusCode: 0, headers: {}, body: '' };
  context.apiGatewayProxyResponse.headers ??= {};
}
