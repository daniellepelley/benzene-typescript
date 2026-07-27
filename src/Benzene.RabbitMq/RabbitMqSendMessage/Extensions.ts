/** Port of Benzene.RabbitMq.RabbitMqSendMessage.Extensions (C# fluent extension methods -> free functions). */
import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { Channel } from 'amqplib';
import { RabbitMqConstants } from '../RabbitMqConstants';
import { RabbitMqClientMiddleware } from './RabbitMqClientMiddleware';
import { RabbitMqContextConverter } from './RabbitMqContextConverter';
import { RabbitMqSendMessageContext } from './RabbitMqSendMessageContext';

/**
 * Appends the terminal {@link RabbitMqClientMiddleware} (built from `channel`) to a RabbitMQ send
 * pipeline. Mirrors `@benzene/clients-aws-sqs`'s `useSqsClient` (takes the transport client explicitly).
 */
export function useRabbitMqClient(
  app: IMiddlewarePipelineBuilder<RabbitMqSendMessageContext>,
  channel: Channel,
  mandatory = false,
  persistent = true,
): IMiddlewarePipelineBuilder<RabbitMqSendMessageContext> {
  return app.use(() => new RabbitMqClientMiddleware(channel, mandatory, persistent));
}

/**
 * Converts a Benzene outbound client context to a RabbitMQ publish and runs it through the given inner
 * pipeline — the integration point for a client (outbound) pipeline, mirroring the C# `UseRabbitMq<T>`.
 *
 * @param exchange The exchange to publish to (empty string for the default exchange).
 * @param action Configures the inner RabbitMQ publish pipeline.
 * @param topicHeaderKey The message-property header the topic is written to (defaults to
 * {@link RabbitMqConstants.DefaultTopicHeader}).
 */
export function useRabbitMq<T>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>>,
  exchange: string,
  action: PipelineBuilderAction<RabbitMqSendMessageContext>,
  topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>> {
  const converter = new RabbitMqContextConverter<T>(new JsonSerializer(), exchange, topicHeaderKey);
  return app.convert(converter, action);
}

/**
 * Convenience combining {@link useRabbitMq} + {@link useRabbitMqClient}: converts an outbound client
 * context to a RabbitMQ publish over the given channel. Port of the C# `UseRabbitMq<T>(channel, exchange)`
 * overload (named distinctly here because TypeScript cannot overload the two `UseRabbitMq` shapes cleanly).
 */
export function useRabbitMqChannel<T>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>>,
  channel: Channel,
  exchange = '',
  topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>> {
  return useRabbitMq<T>(app, exchange, (builder) => useRabbitMqClient(builder, channel), topicHeaderKey);
}
