/**
 * Port of Benzene.Aws.Lambda.Sns.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addSns } from './DependencyInjectionExtensions';
import { SnsApplication } from './SnsApplication';
import { SnsLambdaHandler } from './SnsLambdaHandler';
import { SnsOptions } from './SnsOptions';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Adds SNS handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the SNS services,
 * builds the inner per-record `SnsRecordContext` pipeline from `action`, and appends an `SnsLambdaHandler`
 * (which runs an `SnsApplication` over that pipeline). Optionally configure `SnsOptions` — e.g. set
 * `catchExceptions` to swallow handler exceptions, or `raiseOnFailureStatus` to escalate a non-exception
 * failure result into a thrown exception so SNS retries it too.
 */
export function useSns(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<SnsRecordContext>,
  configure?: (options: SnsOptions) => void,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addSns(x));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new SnsOptions();
  configure?.(options);
  return app.use(
    (resolver) => new SnsLambdaHandler(new SnsApplication(pipeline, options), resolver),
  );
}
