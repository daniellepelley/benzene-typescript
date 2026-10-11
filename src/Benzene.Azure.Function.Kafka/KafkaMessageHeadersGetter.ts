/** Port of Benzene.Azure.Function.Kafka.KafkaMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { DefaultMetadataTopicKey, withoutMetadataKey } from '@benzenejs/core-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts headers from a Kafka event: each entry of the record's `headers`, a string kept as-is and a
 * byte array UTF-8 decoded.
 *
 * DIVERGENCE: the C# getter always returns an empty dictionary. The port reads the headers because the
 * topic is now read from the `topic` header first (transport-bindings.md, Kafka; spec ruling Benzene
 * 0b53dddb) - and a `benzene-version` header must select the handler version. The configured topic header
 * (default `topic`) is consumed: it is the topic, not a header (transport-metadata-cases.json
 * `headersExclude`).
 */
export class KafkaMessageHeadersGetter implements IMessageHeadersGetter<KafkaContext> {
  constructor(private readonly topicHeaderKey: string = DefaultMetadataTopicKey) {}

  getHeaders(context: KafkaContext): Record<string, string> {
    return withoutMetadataKey(KafkaMessageHeadersGetter.decodeHeaders(context), this.topicHeaderKey);
  }

  /** Every record header, decoded, the topic header included - what the topic getter reads. */
  static decodeHeaders(context: KafkaContext): Record<string, string> {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(context.kafkaEvent.headers ?? {})) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (value instanceof Uint8Array) {
        headers[key] = Buffer.from(value).toString('utf8');
      }
    }
    return headers;
  }
}
