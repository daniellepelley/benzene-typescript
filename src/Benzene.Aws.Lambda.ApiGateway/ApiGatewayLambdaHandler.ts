import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter } from '@benzene/aws-lambda-core';
import { APIGatewayProxyEvent } from 'aws-lambda';
import { ApiGatewayApplication } from './ApiGatewayApplication';
import { ApiGatewayContext } from './ApiGatewayContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayLambdaHandler.
 *
 * Routes AWS Lambda invocations whose event is an API Gateway proxy request to the API Gateway
 * middleware pipeline. Added to the outer `AwsEventStreamContext` pipeline by `useApiGateway`; it
 * only handles the invocation if the event has an HTTP method, otherwise it defers to the next
 * middleware.
 *
 * STREAM -> PARSED-EVENT ADAPTATION: `tryExtractRequest` (inherited from `AwsLambdaMiddlewareRouter`)
 * returns the already-parsed `context.event` as `APIGatewayProxyEvent`; `canHandle` does the real
 * discrimination on `httpMethod` (.NET checks `request?.HttpMethod != null`).
 */
export class ApiGatewayLambdaHandler extends AwsLambdaMiddlewareRouter<APIGatewayProxyEvent> {
  private readonly apiGatewayApplication: ApiGatewayApplication;

  constructor(pipeline: IMiddlewarePipeline<ApiGatewayContext>, serviceResolver: IServiceResolver) {
    super(serviceResolver);
    this.apiGatewayApplication = new ApiGatewayApplication(pipeline);
  }

  /** True if the event looks like an API Gateway request (it has an HTTP method). */
  protected canHandle(request: APIGatewayProxyEvent): boolean {
    return request?.httpMethod !== undefined && request?.httpMethod !== null;
  }

  /** Runs the API Gateway application and writes the HTTP response onto the outer context. */
  protected async handleFunction(
    request: APIGatewayProxyEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.apiGatewayApplication.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
