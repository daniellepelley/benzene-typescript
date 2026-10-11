/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { DefaultMetadataTopicKey, findMetadataValue, Topic } from '@benzenejs/core-messages';
import { KafkaMessageHeadersGetter } from './KafkaMessageHeadersGetter';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Extracts the message topic from a consumed record (transport-bindings.md, Kafka): the record's `topic`
 * header (matched case-insensitively, configurable), falling back to the Kafka topic the record was
 * consumed from - so one Kafka topic can carry several Benzene topics, and a producer that writes no
 * header (a non-Benzene one, or one that names its Kafka topics after Benzene topics) still routes. The
 * same rule as RabbitMQ's routing-key fallback.
 *
 * DIVERGENCE: the C# getter returns `new Topic(context.ConsumeResult.Topic)` only; spec ruling
 * Benzene 0b53dddb made the header win. There is still no preset-topic wrapper: the record always
 * carries a Kafka topic to fall back to.
 */
export class KafkaMessageTopicGetter implements IMessageTopicGetter<KafkaRecordContext> {
  /** The default topic header - the spec's reserved `topic` (wire-contracts.md §2). */
  static readonly DefaultTopicHeader = DefaultMetadataTopicKey;

  constructor(private readonly topicHeaderKey: string = KafkaMessageTopicGetter.DefaultTopicHeader) {}

  getTopic(context: KafkaRecordContext): ITopic | undefined {
    const header = findMetadataValue(KafkaMessageHeadersGetter.decodeHeaders(context), this.topicHeaderKey);
    return new Topic(header !== undefined && header !== '' ? header : context.record.topic);
  }
}
