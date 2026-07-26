import { IServiceResolver } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { ApiGatewayCustomAuthorizerContext } from './ApiGatewayCustomAuthorizerContext';

/**
 * The authorize delegate: inspects the request (with access to the current `IServiceResolver`, e.g. to
 * resolve a token validator) and returns the authorizer result. Port of C#'s two
 * `Func<APIGatewayCustomAuthorizerRequest, IServiceResolver, Task<APIGatewayCustomAuthorizerResponse>>`
 * / `Func<APIGatewayCustomAuthorizerRequest, Task<APIGatewayCustomAuthorizerResponse>>` overloads — the
 * single TypeScript signature keeps `serviceResolver` as an optional-to-use trailing argument, so a
 * delegate that ignores it reads exactly like the request-only C# overload.
 */
export type AuthorizeFunc = (
  request: APIGatewayRequestAuthorizerEvent,
  serviceResolver: IServiceResolver,
) => Promise<APIGatewayAuthorizerResult> | APIGatewayAuthorizerResult;

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayCustomAuthorizer.AuthorizerExtensions (C# fluent
 * extension method -> free function taking the builder as the first argument).
 *
 * Adds a custom authorizer step that produces the `APIGatewayAuthorizerResult` for the request: it runs
 * `authorize`, stores the result on the context, then continues the pipeline. This is the first-class way
 * to implement an API Gateway custom (Lambda) authorizer as Benzene middleware.
 */
export function useCustomAuthorizer(
  app: IMiddlewarePipelineBuilder<ApiGatewayCustomAuthorizerContext>,
  authorize: AuthorizeFunc,
): IMiddlewarePipelineBuilder<ApiGatewayCustomAuthorizerContext> {
  return app.useFn('CustomAuthorizer', async (context, next, serviceResolver) => {
    context.apiGatewayCustomAuthorizerResponse = await authorize(
      context.apiGatewayCustomAuthorizerRequest,
      serviceResolver,
    );
    await next();
  });
}
