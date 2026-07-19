/** Port of Benzene.Azure.Function.Kafka.KafkaMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { KafkaContext } from './KafkaContext';

/**
 * Extracts the message body from a Kafka event's value, UTF-8 decoded.
 *
 * FIELD mapping: C# `context.KafkaEvent.Value == null ? null : Encoding.UTF8.GetString(context
 * .KafkaEvent.Value)`. `KafkaRecord.Value` is a `byte[]`, decoded to text via UTF-8. The port models
 * `value` as a `Uint8Array` (the byte-array analogue) and decodes it with `Buffer.from(value)
 * .toString('utf8')`; a `null`/`undefined` value maps to `undefined` (C# `null`).
 */
export class KafkaMessageBodyGetter implements IMessageBodyGetter<KafkaContext> {
  getBody(context: KafkaContext): string | undefined {
    const value = context.kafkaEvent.value;
    return value === undefined || value === null ? undefined : Buffer.from(value).toString('utf8');
  }
}
