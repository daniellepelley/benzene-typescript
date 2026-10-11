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
import { KafkaMessageTopicGetter } from './KafkaMessageTopicGetter';
import { KafkaOptions } from './KafkaOptions';

/**
 * Adds Kafka handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the Kafka services,
 * builds the inner per-record `KafkaContext` pipeline from `action`, and appends a `KafkaLambdaHandler`
 * (which runs a `KafkaApplication` over that pipeline). A record routes on its `topic` header
 * (`topicHeaderKey`), falling back to its native Kafka topic;
 * anything whose event source is not `aws:kafka` falls through to the next event source adapter.
 */
export function useKafka(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<KafkaContext>,
  configure?: (options: KafkaOptions) => void,
  topicHeaderKey: string = KafkaMessageTopicGetter.DefaultTopicHeader,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addKafka(x, topicHeaderKey));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new KafkaOptions();
  configure?.(options);
  return app.use((resolver) => new KafkaLambdaHandler(new KafkaApplication(pipeline, options), resolver));
}
