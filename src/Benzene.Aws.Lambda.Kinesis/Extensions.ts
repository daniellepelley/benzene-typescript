/** Port of Benzene.Aws.Lambda.Kinesis.Extensions (adapted — see the ADAPTATION note). */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addKinesis } from './DependencyInjectionExtensions';
import { KinesisApplication } from './KinesisApplication';
import { KinesisLambdaHandler } from './KinesisLambdaHandler';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * Adds Kinesis handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the Kinesis
 * services, builds the inner per-record `KinesisMessageContext` pipeline from `action`, and appends a
 * `KinesisLambdaHandler` (which runs a `KinesisApplication` over that pipeline).
 *
 * NAME + MODEL ADAPTATION: the C# extension is `UseKinesisStream` (streaming fan-in over
 * `StreamContext<KinesisEventRecord>`). Because the streaming engine is not yet ported, this port adapts
 * to the per-record fan-out shape and names the helper `useKinesis` (matching the task's `addKinesis` /
 * `useKinesis` surface). Kinesis records carry no topic, so route them with `usePresetTopic('<topic>')`
 * before `useMessageHandlers`. See `KinesisMessageContext` for the full rationale.
 */
export function useKinesis(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<KinesisMessageContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addKinesis(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new KinesisLambdaHandler(new KinesisApplication(pipeline), resolver));
}
