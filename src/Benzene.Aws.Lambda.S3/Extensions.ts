/**
 * Port of Benzene.Aws.Lambda.S3.Extensions (C# fluent extension method -> free function taking the builder
 * as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addS3 } from './DependencyInjectionExtensions';
import { S3Application } from './S3Application';
import { S3LambdaHandler } from './S3LambdaHandler';
import { S3RecordContext } from './S3RecordContext';

/**
 * Adds S3 event notification handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the S3
 * services, builds the inner per-record `S3RecordContext` pipeline from `action`, and appends an
 * `S3LambdaHandler` (which runs an `S3Application` over that pipeline). Records are routed by their S3
 * event name (e.g. `ObjectCreated:Put`); anything else falls through to the next event source adapter.
 */
export function useS3(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<S3RecordContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addS3(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new S3LambdaHandler(new S3Application(pipeline), resolver));
}
