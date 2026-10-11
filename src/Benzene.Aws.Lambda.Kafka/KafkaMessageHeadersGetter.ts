/** Port of Benzene.Aws.Lambda.Kafka.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { DefaultMetadataTopicKey, withoutMetadataKey } from '@benzenejs/core-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts headers from a Kafka record, UTF-8 decoding each value.
 *
 * FIELD mapping: in `@types/aws-lambda` `MSKRecord.headers` is `MSKRecordHeader[]` - Kafka's ordered,
 * duplicate-key-capable header list, each entry `{ [key: string]: number[] }` (a byte array). Every entry
 * is flattened into the dictionary, last-wins on a repeated key, and each value is decoded with
 * `Buffer.from(bytes).toString('utf8')` (the port of `Encoding.UTF8.GetString`), as the .NET getter does.
 *
 * The Kafka topic is a routing concept resolved by `KafkaMessageTopicGetter` - it is not surfaced as a
 * header - and the configured topic header (default `topic`) is consumed: it is the topic, not a header
 * (transport-metadata-cases.json `headersExclude`).
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaContext> {
  constructor(private readonly topicHeaderKey: string = DefaultMetadataTopicKey) {}

  getHeaders(context: KafkaContext): Record<string, string> {
    return withoutMetadataKey(KafkaMessageHeadersGetter.decodeHeaders(context), this.topicHeaderKey);
  }

  /** Every record header, UTF-8 decoded, the topic header included - what the topic getter reads. */
  static decodeHeaders(context: KafkaContext): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const entry of context.kafkaEventRecord.headers ?? []) {
      for (const [key, bytes] of Object.entries(entry)) {
        headers[key] = Buffer.from(bytes).toString('utf8');
      }
    }
    return headers;
  }
}
