import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import {
  AwsEventStreamContext,
  AwsLambdaMiddlewareRouter,
  isApiGatewayCustomAuthorizerEvent,
} from '@benzenejs/aws-lambda-core';
import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { ApiGatewayCustomAuthorizerApplication } from './ApiGatewayCustomAuthorizerApplication';
import { ApiGatewayCustomAuthorizerContext } from './ApiGatewayCustomAuthorizerContext';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayCustomAuthorizer.ApiGatewayCustomAuthorizerLambdaHandler.
 *
 * Routes AWS Lambda invocations whose event is an API Gateway REQUEST-type custom authorizer request to
 * the custom authorizer pipeline. Added to the outer `AwsEventStreamContext` pipeline by
 * `useApiGatewayCustomAuthorizer`; it only handles the invocation if the event carries a non-empty
 * `requestContext.apiId` (.NET checks `!string.IsNullOrEmpty(request?.RequestContext?.ApiId)`), otherwise
 * it defers to the next middleware.
 *
 * DISCRIMINATION (bend from .NET): the shared `isApiGatewayCustomAuthorizerEvent` predicate additionally
 * requires `type === "REQUEST"`. In C# the payload is deserialized into the distinct authorizer type
 * first, so an API-ID check alone suffices; under the port's type erasure the router sniffs the raw
 * parsed event, where a v1 proxy event *also* has `requestContext.apiId` — the `type: "REQUEST"`
 * discriminant (absent from proxy events) is what keeps the authorizer from claiming a proxy request. See
 * the README "Porting conventions".
 *
 * (The C# original swaps in a source-generated JSON serializer for a cold-start win; that's a .NET AOT
 * concern with no Node equivalent — the event arrives already parsed — so it is not ported.)
 */
export class ApiGatewayCustomAuthorizerLambdaHandler extends AwsLambdaMiddlewareRouter<APIGatewayRequestAuthorizerEvent> {
  private readonly apiGatewayApplication: ApiGatewayCustomAuthorizerApplication;

  constructor(
    pipeline: IMiddlewarePipeline<ApiGatewayCustomAuthorizerContext>,
    serviceResolver: IServiceResolver,
  ) {
    super(serviceResolver);
    this.apiGatewayApplication = new ApiGatewayCustomAuthorizerApplication(pipeline);
  }

  /** True if the event looks like an API Gateway REQUEST-type custom authorizer request. */
  protected canHandle(request: APIGatewayRequestAuthorizerEvent): boolean {
    return isApiGatewayCustomAuthorizerEvent(request);
  }

  /** Runs the custom authorizer application and writes the authorizer result onto the outer context. */
  protected async handleFunction(
    request: APIGatewayRequestAuthorizerEvent,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.apiGatewayApplication.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
