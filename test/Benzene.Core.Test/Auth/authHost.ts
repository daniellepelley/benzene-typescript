import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { AuthenticationHolder, ClaimsPrincipal } from '@benzene/auth-core';
import { FuncWrapperMiddleware } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import { ApiGatewayContext, useApiGateway } from '@benzene/aws-lambda-api-gateway';

/**
 * Shared harness for the auth tests. The C# auth suite (BasicAuthTest / AuthorizationTest) hosts a
 * real Kestrel `AspNetContext` pipeline and drives it over HTTP; the TypeScript port has no ASP.NET
 * host, so these tests reuse the API Gateway transport - a genuine `IHttpContext` with request/
 * response adapters wired - as the HTTP host, exactly as `ApiGatewayPipelineTest` does. `GET /secure`
 * (below) is the protected downstream route every case probes, standing in for the C# `/example`.
 */

class SecureRequest {}

class SecureResponse {
  ok = true;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('GET', '/secure')
@message('secure', { registry, requestType: SecureRequest, responseType: SecureResponse })
class SecureHandler implements IMessageHandler<SecureRequest, SecureResponse> {
  handleAsync(): Promise<IBenzeneResultOf<SecureResponse>> {
    return Promise.resolve(BenzeneResult.ok(new SecureResponse()));
  }
}

/** Builds an API Gateway `GET /secure` event, optionally carrying an `Authorization` header. */
export function createSecureEvent(authorization?: string): APIGatewayProxyEvent {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== undefined) {
    headers['authorization'] = authorization;
  }

  return {
    httpMethod: 'GET',
    path: '/secure',
    resource: '/secure',
    body: null,
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    isBase64Encoded: false,
    requestContext: {} as APIGatewayProxyEvent['requestContext'],
  };
}

/**
 * Runs an API Gateway pipeline whose auth/authorization middleware is configured by `configureAuth`
 * (called on the HTTP builder before `useMessageHandlers`), and returns the resulting
 * `APIGatewayProxyResult` for the given event.
 */
export async function runSecure(
  configureAuth: (api: IMiddlewarePipelineBuilder<ApiGatewayContext>) => void,
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  const entryPoint = new InlineAwsLambdaStartUp()
    .configureServices((services) => addBenzene(services))
    .configure((app) =>
      useApiGateway(app, (api) => {
        configureAuth(api);
        useMessageHandlers(api, SecureHandler);
      }),
    )
    .build();

  return (await entryPoint.functionHandlerAsync(event, {} as Context)) as APIGatewayProxyResult;
}

/**
 * Seeds the per-message {@link AuthenticationHolder} with `principal` via an inline middleware placed
 * before the authorization check. Stands in for the authentication middleware (`useBasicAuth`, or the
 * not-yet-ported OAuth2 bearer) that would set the principal in a real pipeline, so the authorization
 * primitives can be exercised in isolation.
 */
export function seedPrincipal<TContext>(
  api: IMiddlewarePipelineBuilder<TContext>,
  principal: ClaimsPrincipal,
): void {
  api.use(
    (resolver) =>
      new FuncWrapperMiddleware<TContext>('seed-principal', async (_context, next) => {
        resolver.getService(AuthenticationHolder).principal = principal;
        await next();
      }),
  );
}

/** Case-insensitive lookup over an `APIGatewayProxyResult`'s headers. */
export function findHeader(
  headers: APIGatewayProxyResult['headers'],
  key: string,
): string | number | boolean | undefined {
  if (!headers) {
    return undefined;
  }
  const lowerKey = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers)) {
    if (headerKey.toLowerCase() === lowerKey) {
      return headerValue;
    }
  }
  return undefined;
}
