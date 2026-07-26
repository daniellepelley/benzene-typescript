import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { ApiGatewayCustomAuthorizerContext } from './ApiGatewayCustomAuthorizerContext';
import { ApiGatewayCustomAuthorizerLambdaHandler } from './ApiGatewayCustomAuthorizerLambdaHandler';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.ApiGatewayCustomAuthorizer.Extensions (C# fluent extension
 * method -> free function taking the builder as the first argument).
 *
 * Naming divergence: C# keeps this `UseApiGatewayCustomAuthorizer` in an `Extensions` class inside the
 * `ApiGatewayCustomAuthorizer` sub-namespace, so it does not collide with the outer `Extensions.UseApiGateway`.
 * The TypeScript port flattens the namespace into one package barrel, so the file is prefixed
 * (`ApiGatewayCustomAuthorizerExtensions`) to avoid clashing with the package's `Extensions.ts`; the
 * exported function name is unchanged. See the README "Porting conventions".
 *
 * Adds API Gateway custom authorizer handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: builds
 * the inner `ApiGatewayCustomAuthorizerContext` pipeline from `action`, and appends an
 * `ApiGatewayCustomAuthorizerLambdaHandler` (which runs an `ApiGatewayCustomAuthorizerApplication` over
 * that pipeline). Mirrors the structure of `useApiGateway`.
 */
export function useApiGatewayCustomAuthorizer(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<ApiGatewayCustomAuthorizerContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new ApiGatewayCustomAuthorizerLambdaHandler(pipeline, resolver));
}
