/** Port of Benzene.Kafka.Core.Kafka.KafkaClientMiddleware. */
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { Producer } from 'kafkajs';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * The terminal middleware at the bottom of an outbound Kafka pipeline: produces the
 * {@link KafkaSendMessageContext}'s message to its topic via the shared kafkajs `Producer` and records
 * the produce result. It does not call `next`.
 *
 * SDK-MAPPING BEND: C# calls `IProducer.ProduceAsync(topic, message)`. kafkajs's `Producer` has no
 * single-message `ProduceAsync`; it takes a `ProducerRecord` (`{ topic, messages }`), so the middleware
 * sends a one-message batch and stores the resulting `RecordMetadata[]`.
 */
export class KafkaClientMiddleware implements IMiddleware<KafkaSendMessageContext> {
  readonly name = 'KafkaClientMiddleware';

  constructor(private readonly producer: Producer) {}

  async handleAsync(context: KafkaSendMessageContext, _next: NextFunc): Promise<void> {
    context.response = await this.producer.send({
      topic: context.topic,
      messages: [context.message],
    });
  }
}
