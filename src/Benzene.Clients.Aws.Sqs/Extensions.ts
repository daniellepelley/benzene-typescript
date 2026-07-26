import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { OutboundContext } from '@benzene/clients';
import { SQSClient } from '@aws-sdk/client-sqs';
import { OutboundSqsContextConverter } from './OutboundSqsContextConverter';
import { SqsClientMiddleware } from './SqsClientMiddleware';
import { SqsSendMessageContext } from './SqsSendMessageContext';

/**
 * Port of Benzene.Clients.Aws.Sqs.Extensions (C# fluent extension methods -> free functions taking the
 * builder first).
 *
 * PORT DIVERGENCE: the C# `.UseSqs(queueUrl)` resolves `IAmazonSQS` from the container; the TypeScript port
 * takes the `SQSClient` explicitly (there is no synthetic DI token for the raw AWS SDK client). Pass the
 * `@aws-sdk/client-sqs` `SQSClient` the send should use.
 */

/** Appends the terminal `SqsClientMiddleware` (built from `amazonSqs`) to an SQS send pipeline. */
export function useSqsClient(
  app: IMiddlewarePipelineBuilder<SqsSendMessageContext>,
  amazonSqs: SQSClient,
): IMiddlewarePipelineBuilder<SqsSendMessageContext> {
  return app.use(() => new SqsClientMiddleware(amazonSqs));
}

/**
 * Converts an outbound route pipeline (`OutboundRoutingBuilder.route`) to send via SQS: the routed message
 * becomes the SQS message body, the topic + per-call headers become message attributes.
 */
export function useSqs(
  app: IMiddlewarePipelineBuilder<OutboundContext>,
  queueUrl: string,
  amazonSqs: SQSClient,
  topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
): IMiddlewarePipelineBuilder<OutboundContext> {
  return app.convert(new OutboundSqsContextConverter(queueUrl, topicAttributeKey), (builder) =>
    useSqsClient(builder, amazonSqs),
  );
}
