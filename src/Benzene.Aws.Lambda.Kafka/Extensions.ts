/**
 * Port of Benzene.Aws.Lambda.Kafka.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { AwsEventStreamContext } from '@benzene/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzene/core-middleware';
import { addKafka } from './DependencyInjectionExtensions';
import { KafkaApplication } from './KafkaApplication';
import { KafkaContext } from './KafkaContext';
import { KafkaLambdaHandler } from './KafkaLambdaHandler';

/**
 * Adds Kafka handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the Kafka services,
 * builds the inner per-record `KafkaContext` pipeline from `action`, and appends a `KafkaLambdaHandler`
 * (which runs a `KafkaApplication` over that pipeline). Records are routed by their native Kafka topic;
 * anything whose event source is not `aws:kafka` falls through to the next event source adapter.
 */
export function useKafka(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<KafkaContext>,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addKafka(x));
  const pipeline = createMiddlewarePipeline(app, action);
  return app.use((resolver) => new KafkaLambdaHandler(new KafkaApplication(pipeline), resolver));
}
