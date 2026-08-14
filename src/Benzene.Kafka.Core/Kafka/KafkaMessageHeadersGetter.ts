/** Port of Benzene.Kafka.Core.Kafka.KafkaMessageHeadersGetter (class `KafkaSendMessageHeadersGetter`). */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * Reads the headers off a {@link KafkaSendMessageContext} — the send-side counterpart of the inbound
 * `KafkaMessageHeadersGetter`.
 *
 * MESSAGE-TYPE ADAPTATION: C# reads the Confluent `Message.Headers` ordered list, UTF-8 decoding each
 * value and building the dictionary last-wins (Kafka permits repeated keys; `ToDictionary` would throw).
 * kafkajs exposes headers as an `IHeaders` object (`{ [key]: Buffer | string | (Buffer | string)[] |
 * undefined }`); each value is UTF-8 decoded to a string, and a repeated-key array takes its last element
 * (last-wins), matching the C# behaviour and the inbound getter.
 */
export class KafkaSendMessageHeadersGetter implements IMessageHeadersGetter<KafkaSendMessageContext> {
  getHeaders(context: KafkaSendMessageContext): Record<string, string> {
    const dictionary: Record<string, string> = {};
    const headers = context.message.headers;
    if (headers !== undefined) {
      for (const [key, value] of Object.entries(headers)) {
        if (value === undefined) {
          continue;
        }
        const single = Array.isArray(value) ? value[value.length - 1] : value;
        dictionary[key] = typeof single === 'string' ? single : Buffer.from(single).toString('utf8');
      }
    }
    return dictionary;
  }
}
