/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { DefaultMetadataTopicKey, withoutMetadataKey } from '@benzenejs/core-messages';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Extracts headers from a consumed record.
 *
 * MESSAGE-TYPE ADAPTATION: C# reads Confluent.Kafka `Message.Headers` (an ordered list, UTF-8 decoding
 * each `byte[]` value) and builds the dictionary with a last-wins indexer rather than `ToDictionary`,
 * because Kafka headers legitimately permit repeated keys. kafkajs exposes headers as an
 * `IHeaders` object (`{ [key]: Buffer | string | (Buffer | string)[] | undefined }`); each value is
 * UTF-8 decoded to a string, and a repeated-key array takes its last element (last-wins), matching the
 * C# behaviour.
 *
 * The configured topic header (default `topic`) is consumed: it is the topic, not a header
 * (transport-metadata-cases.json `headersExclude`), matched case-insensitively like the topic getter.
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaRecordContext> {
  constructor(private readonly topicHeaderKey: string = DefaultMetadataTopicKey) {}

  getHeaders(context: KafkaRecordContext): Record<string, string> {
    return withoutMetadataKey(KafkaMessageHeadersGetter.decodeHeaders(context), this.topicHeaderKey);
  }

  /** Every record header, UTF-8 decoded, the topic header included - what the topic getter reads. */
  static decodeHeaders(context: KafkaRecordContext): Record<string, string> {
    const dictionary: Record<string, string> = {};
    const headers = context.record.message.headers;
    if (headers !== undefined) {
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) {
          continue;
        }
        // kafkajs may deliver a repeated header key as an array; take the last occurrence (last-wins).
        const single = Array.isArray(value) ? value[value.length - 1] : value;
        if (single === undefined) {
          continue;
        }
        dictionary[key] = decode(single);
      }
    }
    return dictionary;
  }
}

function decode(value: Buffer | string): string {
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}
