import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { ApiGatewayContext } from './ApiGatewayContext';
import { ApiGatewayLambdaHandler } from './ApiGatewayLambdaHandler';
import { ApiGatewayV2Context } from './ApiGatewayV2Context';
import { ApiGatewayV2LambdaHandler } from './ApiGatewayV2LambdaHandler';
import { addApiGateway, addApiGatewayV2 } from './DependencyInjectionExtensions';

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
 * The v2 (HTTP API, payload format 2.0) counterpart of {@link useApiGateway}. Registers the v2 services,
 * builds the inner `ApiGatewayV2Context` pipeline from `action`, and appends an `ApiGatewayV2LambdaHandler`.
 * Because v1 and v2 handlers discriminate on mutually-exclusive event shapes, an app can wire both
 * `useApiGateway` and `useApiGatewayV2` and each claims only its own payload format.
 */
export function useApiGatewayV2(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<ApiGatewayV2Context>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addApiGatewayV2(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new ApiGatewayV2LambdaHandler(pipeline, resolver));
}

/**
 * Ensures the context's API Gateway response and its headers are initialized. Port of C#
 * `Extensions.EnsureResponseExists`. Re-exported from its leaf module `ApiGatewayContext` (where it
 * is defined to avoid an import cycle) so the public API location still matches C#.
 */
export { ensureResponseExists } from './ApiGatewayContext';

/** The v2 counterpart of {@link ensureResponseExists}. Port of C# `EnsureResponseExists(ApiGatewayV2Context)`. */
export { ensureV2ResponseExists } from './ApiGatewayV2Context';
