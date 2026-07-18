import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addSqs } from './DependencyInjectionExtensions';
import { SqsApplication } from './SqsApplication';
import { SqsLambdaHandler } from './SqsLambdaHandler';
import { SqsMessageContext } from './SqsMessageContext';
import { SqsOptions } from './SqsOptions';

/**
 * Port of Benzene.Aws.Lambda.Sqs.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 *
 * Adds SQS handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the SQS services,
 * builds the inner per-record `SqsMessageContext` pipeline from `action`, and appends an
 * `SqsLambdaHandler` (which runs an `SqsApplication` over that pipeline). Optionally configure
 * `SqsOptions` (e.g. set `batchFailureMode` to `FailWholeBatch`).
 */
export function useSqs(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<SqsMessageContext>,
  configure?: (options: SqsOptions) => void,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addSqs(x));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new SqsOptions();
  configure?.(options);
  return app.use(
    (resolver) => new SqsLambdaHandler(new SqsApplication(pipeline, options), resolver),
  );
}
