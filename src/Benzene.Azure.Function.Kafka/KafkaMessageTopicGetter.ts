/** Port of Benzene.Azure.Function.Kafka.KafkaMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts the message topic from a Kafka event's native topic name — no `topic` attribute needs
 * bolting on the way SQS/SNS/Service Bus require, since Kafka records carry their own topic. Field
 * mapping: C# `new Topic(context.KafkaEvent.Topic)` becomes `new Topic(context.kafkaEvent.topic)`.
 */
export class KafkaMessageTopicGetter implements IMessageTopicGetter<KafkaContext> {
  getTopic(context: KafkaContext): ITopic | undefined {
    return new Topic(context.kafkaEvent.topic);
  }
}
