import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext, AwsLambdaMiddlewareRouter, isApiGatewayV2Event } from '@benzene/aws-lambda-core';
import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ApiGatewayV2Application } from './ApiGatewayV2Application';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayV2LambdaHandler.
 *
 * Routes AWS Lambda invocations whose event is an API Gateway HTTP API v2 request to the v2 pipeline.
 * Added to the outer `AwsEventStreamContext` pipeline by `useApiGatewayV2`. It handles the invocation
 * only if the event carries a v2 discriminant (`version === "2.0"` or a `requestContext.http.method`);
 * a v1 event has neither (its method is the top-level `httpMethod`), so at the *event* level v1 and v2
 * are unambiguously distinguishable.
 *
 * NOTE (erasure): unlike C#, which keys DI by the closed generic `IMessageTopicGetter<ApiGatewayV2Context>`
 * (distinct from v1's), the TypeScript port resolves getters/adapters under one erased `<unknown>` token
 * per container. So v1 and v2 — like any two transports — cannot share a single entry point's container;
 * wire each in its own `Inline*StartUp`/`toLambdaHandler` entry point (the port's one-transport-per-entry-
 * point pattern, as in `examples/aws-lambda-functions`). Point an HTTP API at the v2 handler and a REST
 * API at the v1 handler.
 *
 * (The C# original swaps in a source-generated JSON serializer for a cold-start win; that's a .NET AOT
 * concern with no Node equivalent — the event arrives already parsed — so it is not ported.)
 */
export class ApiGatewayV2LambdaHandler extends AwsLambdaMiddlewareRouter<APIGatewayProxyEventV2> {
  private readonly apiGatewayApplication: ApiGatewayV2Application;

  constructor(pipeline: IMiddlewarePipeline<ApiGatewayV2Context>, serviceResolver: IServiceResolver) {
    super(serviceResolver);
    this.apiGatewayApplication = new ApiGatewayV2Application(pipeline);
  }

  /** True if the event looks like an API Gateway HTTP API v2 request. */
  protected canHandle(request: APIGatewayProxyEventV2): boolean {
    return isApiGatewayV2Event(request);
  }

  /** Runs the v2 application and writes the HTTP response onto the outer context. */
  protected async handleFunction(
    request: APIGatewayProxyEventV2,
    context: AwsEventStreamContext,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<void> {
    const response = await this.apiGatewayApplication.handleAsync(request, serviceResolverFactory);
    this.mapResponse(context, response);
  }
}
