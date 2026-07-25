/** Port of Benzene.Azure.Function.Kafka.TestHelpers.MessageBuilderExtensions. */
import { KafkaRecord } from '@benzene/azure-function-kafka';
import { IMessageBuilder } from '@benzene/abstractions';
import { MessageSerializer } from '@benzene/testing';
import { jsonMessageSerializer } from './defaults';

export interface AsAzureKafkaEventOptions {
  serializer?: MessageSerializer;
}

/**
 * Builds an Azure Functions `KafkaRecord` from a message builder: the topic rides in the record's native
 * `topic` field and the serialized message is the UTF-8 byte `value` the body getter decodes. Port of
 * `AsAzureKafkaEvent`. `handleKafkaEvents(app, ...records)` takes one or more of these.
 */
export function asAzureKafkaEvent<T>(
  source: IMessageBuilder<T>,
  options: AsAzureKafkaEventOptions = {},
): KafkaRecord {
  const { serializer = jsonMessageSerializer } = options;
  return {
    topic: source.topic,
    value: Buffer.from(serializer.serialize(source.message), 'utf8'),
  };
}
