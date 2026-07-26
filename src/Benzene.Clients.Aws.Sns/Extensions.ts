import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { SNSClient } from '@aws-sdk/client-sns';
import { OutboundSnsContextConverter } from './OutboundSnsContextConverter';
import { SnsClientMiddleware } from './SnsClientMiddleware';
import { SnsSendMessageContext } from './SnsSendMessageContext';

/**
 * Port of Benzene.Clients.Aws.Sns.Extensions (fluent extension methods -> builder-first free functions).
 * PORT DIVERGENCE: the `SNSClient` is passed explicitly rather than resolved from the container (see the
 * SQS package's note).
 */
export function useSnsClient(
  app: IMiddlewarePipelineBuilder<SnsSendMessageContext>,
  amazonSns: SNSClient,
): IMiddlewarePipelineBuilder<SnsSendMessageContext> {
  return app.use(() => new SnsClientMiddleware(amazonSns));
}

/** Converts an outbound route pipeline to publish via SNS (the routed message becomes the SNS message). */
export function useSns(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  topicArn: string,
  amazonSns: SNSClient,
  topicAttributeKey: string = OutboundSnsContextConverter.DefaultTopicAttribute,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundSnsContextConverter(topicArn, topicAttributeKey), (builder) =>
    useSnsClient(builder, amazonSns),
  );
}
