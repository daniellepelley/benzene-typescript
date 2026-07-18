import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { ApiGatewayContext } from './ApiGatewayContext';
import { ApiGatewayLambdaHandler } from './ApiGatewayLambdaHandler';
import { addApiGateway } from './DependencyInjectionExtensions';

/**
 * Port of Benzene.Aws.Lambda.ApiGateway.Extensions (C# fluent extension methods -> free functions
 * taking the builder as the first argument).
 *
 * Adds API Gateway handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the API
 * Gateway services, builds the inner `ApiGatewayContext` pipeline from `action`, and appends an
 * `ApiGatewayLambdaHandler` (which runs an `ApiGatewayApplication` over that pipeline). Mirrors the
 * structure of `useSqs`.
 */
export function useApiGateway(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<ApiGatewayContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addApiGateway(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new ApiGatewayLambdaHandler(pipeline, resolver));
}

/**
 * Ensures the context's API Gateway response and its headers are initialized. Port of C#
 * `Extensions.EnsureResponseExists`. Re-exported from its leaf module `ApiGatewayContext` (where it
 * is defined to avoid an import cycle) so the public API location still matches C#.
 */
export { ensureResponseExists } from './ApiGatewayContext';
