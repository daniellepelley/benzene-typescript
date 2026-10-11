/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { DefaultMetadataTopicKey, findMetadataValue, Topic } from '@benzenejs/core-messages';
import { KafkaContext } from './KafkaContext';
import { KafkaMessageHeadersGetter } from './KafkaMessageHeadersGetter';

/**
 * Extracts the message topic from a Kafka record (transport-bindings.md, Kafka): the record's `topic`
 * header (matched case-insensitively, configurable), falling back to the Kafka topic the record was
 * consumed from (`kafkaEventRecord.topic`), so a producer that writes no header still routes.
 *
 * DIVERGENCE: the C# getter reads `KafkaEventRecord.Topic` only; spec ruling Benzene 0b53dddb made the
 * header win.
 */
export class KafkaMessageTopicGetter implements IMessageTopicGetter<KafkaContext> {
  /** The default topic header - the spec's reserved `topic` (wire-contracts.md §2). */
  static readonly DefaultTopicHeader = DefaultMetadataTopicKey;

  constructor(private readonly topicHeaderKey: string = KafkaMessageTopicGetter.DefaultTopicHeader) {}

  getTopic(context: KafkaContext): ITopic | undefined {
    const header = findMetadataValue(KafkaMessageHeadersGetter.decodeHeaders(context), this.topicHeaderKey);
    return new Topic(header !== undefined && header !== '' ? header : context.kafkaEventRecord.topic);
  }
}
