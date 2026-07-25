import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { MiddlewareApplicationWithResult } from '@benzene/core-middleware';
import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2Application.
 *
 * Wraps the API Gateway HTTP API v2 middleware pipeline, converting an incoming `APIGatewayProxyEventV2`
 * into an `ApiGatewayV2Context` and back into an `APIGatewayProxyStructuredResultV2`. The result mapper
 * returns the response any response handler populated (via `ensureV2ResponseExists`); for a handled
 * request it is always set by the time the pipeline completes (`ApiGatewayV2LambdaHandler.canHandle`
 * gates entry).
 */
export class ApiGatewayV2Application extends MiddlewareApplicationWithResult<
  APIGatewayProxyEventV2,
  ApiGatewayV2Context,
  APIGatewayProxyStructuredResultV2
> {
  constructor(pipeline: IMiddlewarePipeline<ApiGatewayV2Context>) {
    super(
      pipeline,
      (event) => new ApiGatewayV2Context(event),
      (context) => context.apiGatewayProxyResponse as APIGatewayProxyStructuredResultV2,
    );
  }
}
