/**
 * Port of Benzene.Aws.Lambda.Sns.Extensions (C# fluent extension method -> free function taking the
 * builder as its first argument).
 */
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { AwsEventStreamContext } from '@benzenejs/aws-lambda-core';
import { createMiddlewarePipeline } from '@benzenejs/core-middleware';
import { addSns } from './DependencyInjectionExtensions';
import { SnsMessageTopicGetter } from './SnsMessageTopicGetter';
import { SnsApplication } from './SnsApplication';
import { SnsLambdaHandler } from './SnsLambdaHandler';
import { SnsOptions } from './SnsOptions';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Adds SNS handling to an AWS Lambda (`AwsEventStreamContext`) pipeline: registers the SNS services,
 * builds the inner per-record `SnsRecordContext` pipeline from `action`, and appends an `SnsLambdaHandler`
 * (which runs an `SnsApplication` over that pipeline). Optionally configure `SnsOptions`: the defaults
 * redeliver a failure result, a missing result and an uncaught exception; set `ignoreUnmatchedTopics` for a
 * subscription that sees other services' topics, or `atMostOnce` to acknowledge every notification.
 * `topicAttributeKey` renames the message attribute the topic is read from (default `topic`,
 * wire-contracts.md §2).
 */
export function useSns(
  app: IMiddlewarePipelineBuilder<AwsEventStreamContext>,
  action: PipelineBuilderAction<SnsRecordContext>,
  configure?: (options: SnsOptions) => void,
  topicAttributeKey: string = SnsMessageTopicGetter.DefaultTopicAttribute,
): IMiddlewarePipelineBuilder<AwsEventStreamContext> {
  app.register((x) => addSns(x, topicAttributeKey));
  const pipeline = createMiddlewarePipeline(app, action);
  const options = new SnsOptions();
  configure?.(options);
  return app.use(
    (resolver) => new SnsLambdaHandler(new SnsApplication(pipeline, options), resolver),
  );
}
