import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareApplicationWithResult } from '@benzene/core-middleware';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayApplication.
 *
 * Wraps the API Gateway middleware pipeline, converting an incoming `APIGatewayProxyEvent` into an
 * `ApiGatewayContext` and back into an `APIGatewayProxyResult`.
 *
 * C# `MiddlewareApplication<APIGatewayProxyRequest, ApiGatewayContext, APIGatewayProxyResponse>` (the
 * arity-3, result-returning variant) maps to the port's
 * `MiddlewareApplicationWithResult<APIGatewayProxyEvent, ApiGatewayContext, APIGatewayProxyResult>`,
 * per the `WithResult` suffix rule.
 *
 * The result mapper returns `context.apiGatewayProxyResponse`, which any response handler populates
 * (via `ensureResponseExists`); for a handled request it is always set by the time the pipeline
 * completes. It is asserted non-`undefined` here — an unhandled request never reaches this mapper
 * because `ApiGatewayLambdaHandler.canHandle` gates entry.
 */
export class ApiGatewayApplication extends MiddlewareApplicationWithResult<
  APIGatewayProxyEvent,
  ApiGatewayContext,
  APIGatewayProxyResult
> {
  constructor(pipeline: IMiddlewarePipeline<ApiGatewayContext>) {
    super(
      pipeline,
      (event) => new ApiGatewayContext(event),
      (context) => context.apiGatewayProxyResponse as APIGatewayProxyResult,
    );
  }
}
