/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts the message topic from a Kafka record's native topic name — no `topic` attribute needs bolting
 * on the way SQS/SNS require. Field mapping: C# `KafkaEventRecord.Topic` becomes `kafkaEventRecord.topic`.
 */
export class KafkaMessageTopicGetter implements IMessageTopicGetter<KafkaContext> {
  getTopic(context: KafkaContext): ITopic | undefined {
    return new Topic(context.kafkaEventRecord.topic);
  }
}
