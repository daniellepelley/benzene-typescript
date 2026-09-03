/**
 * Port of Benzene.Aws.Lambda.Kafka.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext } from '@benzenejs/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzenejs/core-middleware';
import { addKafka } from './DependencyInjectionExtensions';
import { KafkaApplication } from './KafkaApplication';
import { KafkaContext } from './KafkaContext';
import { KafkaLambdaHandler } from './KafkaLambdaHandler';
import { KafkaOptions } from './KafkaOptions';

/**
 * Adds Kafka handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the Kafka services,
 * builds the inner per-record `KafkaContext` pipeline from `action`, and appends a `KafkaLambdaHandler`
 * (which runs a `KafkaApplication` over that pipeline). Records are routed by their native Kafka topic;
 * anything whose event source is not `aws:kafka` falls through to the next event source adapter.
 * Optionally configure `KafkaOptions` — the default `batchFailureMode` is
 * `KafkaBatchFailureMode.PartialBatchFailure` (failed partitions reported via
 * `ReportBatchItemFailures`).
 */
export function useKafka(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<KafkaContext>,
  configure?: (options: KafkaOptions) => void,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addKafka(x));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new KafkaOptions();
  configure?.(options);
  return app.use(
    (resolver) => new KafkaLambdaHandler(new KafkaApplication(pipeline, options), resolver),
  );
}
