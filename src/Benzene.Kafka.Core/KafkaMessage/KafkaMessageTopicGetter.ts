/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Extracts the message topic from a consumed record.
 *
 * Unlike SQS/Event Hubs (whose routing topic comes from a configurable message property), a Kafka
 * record has a native topic — the C# getter returns `new Topic(context.ConsumeResult.Topic)`, so this
 * port reads `record.topic` directly. No preset-topic fallback wrapper is needed (the record always
 * carries its topic), which is why `addKafkaConsumer` registers this getter directly rather than behind
 * a `PresetTopicMessageTopicGetter`.
 */
export class KafkaMessageTopicGetter implements IMessageTopicGetter<KafkaRecordContext> {
  getTopic(context: KafkaRecordContext): ITopic | undefined {
    return new Topic(context.record.topic);
  }
}
