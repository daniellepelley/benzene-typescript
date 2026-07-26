import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareApplicationWithResult } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { ApiGatewayCustomAuthorizerContext } from './ApiGatewayCustomAuthorizerContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayCustomAuthorizer.ApiGatewayCustomAuthorizerApplication.
 *
 * Wraps the custom authorizer middleware pipeline, converting an incoming `APIGatewayRequestAuthorizerEvent`
 * into an `ApiGatewayCustomAuthorizerContext` and back into the `APIGatewayAuthorizerResult` the pipeline
 * produced.
 *
 * Faithful to .NET: the pipeline is wrapped in `TransportMiddlewarePipeline('api-gateway', pipeline)`
 * (the port of C#'s `new TransportMiddlewarePipeline(TransportNames.ApiGateway, pipeline)`), so
 * `ICurrentTransport` reports `api-gateway` while the authorizer runs. C#
 * `MiddlewareApplication<APIGatewayCustomAuthorizerRequest, ApiGatewayCustomAuthorizerContext,
 * APIGatewayCustomAuthorizerResponse>` (the arity-3, result-returning variant) maps to
 * `MiddlewareApplicationWithResult<...>`, per the `WithResult` suffix rule.
 *
 * The result mapper returns `context.apiGatewayCustomAuthorizerResponse`, which a `useCustomAuthorizer`
 * step sets; for a handled request it is always set by the time the pipeline completes (an unhandled
 * request never reaches this mapper, because `ApiGatewayCustomAuthorizerLambdaHandler.canHandle` gates
 * entry).
 */
export class ApiGatewayCustomAuthorizerApplication extends MiddlewareApplicationWithResult<
  APIGatewayRequestAuthorizerEvent,
  ApiGatewayCustomAuthorizerContext,
  APIGatewayAuthorizerResult
> {
  constructor(pipeline: IMiddlewarePipeline<ApiGatewayCustomAuthorizerContext>) {
    super(
      new TransportMiddlewarePipeline<ApiGatewayCustomAuthorizerContext>('api-gateway', pipeline),
      (event) => new ApiGatewayCustomAuthorizerContext(event),
      (context) => context.apiGatewayCustomAuthorizerResponse as APIGatewayAuthorizerResult,
    );
  }
}
