import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareApplicationWithResult } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
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
 * Faithful to .NET: the pipeline is wrapped in `TransportMiddlewarePipeline('api-gateway', pipeline)`
 * (the port of C#'s `new TransportMiddlewarePipeline(TransportNames.ApiGateway, pipeline)`), so
 * `ICurrentTransport` reports `api-gateway` while the request runs — matching the SNS/S3/Kinesis/… apps.
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
      new TransportMiddlewarePipeline<ApiGatewayContext>('api-gateway', pipeline),
      (event) => new ApiGatewayContext(event),
      (context) => context.apiGatewayProxyResponse as APIGatewayProxyResult,
    );
  }
}
