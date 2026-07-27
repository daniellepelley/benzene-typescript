import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { IBenzeneApplicationBuilder, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
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
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { ApiGatewayContext, useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { benzeneTestHost, httpBuilder, type BenzeneStartUp } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';

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
  const request = httpBuilder('GET', '/secure');
  if (authorization !== undefined) {
    request.withHeader('authorization', authorization);
  }
  return asApiGatewayRequest(request);
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
  // The startup closes over `configureAuth`, so it is declared inside the function.
  class SecureStartUp implements BenzeneStartUp {
    configureServices(services: IBenzeneServiceContainer): void {
      addBenzene(services);
    }

    configure(app: IBenzeneApplicationBuilder): void {
      useAwsLambda(app, (aws) =>
        useApiGateway(aws, (api) => {
          configureAuth(api);
          useMessageHandlers(api, SecureHandler);
        }),
      );
    }
  }

  const host = benzeneTestHost(SecureStartUp).buildAwsLambdaHost();
  return host.sendEventAsync<APIGatewayProxyResult>(event);
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
