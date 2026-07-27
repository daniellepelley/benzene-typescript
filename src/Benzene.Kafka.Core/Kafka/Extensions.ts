/** Port of Benzene.Kafka.Core.Kafka.Extensions (C# fluent extension methods -> free functions taking the builder first). */
import { VoidResult } from '@benzene/abstractions';
import { IBenzeneClientContext } from '@benzene/abstractions-messages';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { Producer } from 'kafkajs';
import { KafkaClientMiddleware } from './KafkaClientMiddleware';
import { KafkaContextConverter } from './KafkaContextConverter';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * Appends the terminal {@link KafkaClientMiddleware} (built from `producer`) to a Kafka send pipeline.
 *
 * PORT DIVERGENCE: the C# parameterless `.UseKafkaClient()` overload resolves the middleware (and thus
 * the `IProducer`) from the container; the TypeScript port takes the `kafkajs` `Producer` explicitly
 * (there is no synthetic DI token for the raw producer), mirroring how `@benzene/clients-aws-sqs`'s
 * `useSqsClient` takes the `SQSClient`.
 */
export function useKafkaClient(
  app: IMiddlewarePipelineBuilder<KafkaSendMessageContext>,
  producer: Producer,
): IMiddlewarePipelineBuilder<KafkaSendMessageContext> {
  return app.use(() => new KafkaClientMiddleware(producer));
}

/**
 * Converts a Benzene outbound client context to a Kafka produce and runs it through the given inner
 * pipeline — the integration point for a client (outbound) pipeline, mirroring the C# `UseKafka<T>`.
 *
 * @param keyHeader The request header whose value becomes the Kafka message key (see
 * {@link KafkaContextConverter}); omit for a keyless message.
 */
export function useKafka<T>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>>,
  action: PipelineBuilderAction<KafkaSendMessageContext>,
  keyHeader?: string,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>> {
  return app.convert(new KafkaContextConverter<T>(new JsonSerializer(), keyHeader), action);
}
