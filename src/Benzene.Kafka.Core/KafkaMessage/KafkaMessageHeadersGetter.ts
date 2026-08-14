/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
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
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaRecordContext> {
  getHeaders(context: KafkaRecordContext): Record<string, string> {
    const dictionary: Record<string, string> = {};
    const headers = context.record.message.headers;
    if (headers !== undefined) {
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) {
          continue;
        }
        // kafkajs may deliver a repeated header key as an array; take the last occurrence (last-wins).
        const single = Array.isArray(value) ? value[value.length - 1] : value;
        dictionary[key] = decode(single);
      }
    }
    return dictionary;
  }
}

function decode(value: Buffer | string): string {
  return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
}
