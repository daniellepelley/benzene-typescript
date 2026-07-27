/** Port of Benzene.Kafka.Core.KafkaMessage.KafkaMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { KafkaRecordContext } from './KafkaRecordContext';

/**
 * Extracts the record value as a string.
 *
 * MESSAGE-TYPE ADAPTATION: C# switches on the generic `TValue` (`byte[]` is UTF-8 decoded — not
 * `.ToString()`'d, which would yield "System.Byte[]"; a `string` passes through). kafkajs always
 * delivers `message.value` as a `Buffer | null` (there is no typed value), so the common case is the
 * `byte[]` branch — UTF-8 decode it — with a `null` value mapping to `undefined` (C# `null`).
 */
export class KafkaMessageBodyGetter implements IMessageBodyGetter<KafkaRecordContext> {
  getBody(context: KafkaRecordContext): string | undefined {
    const value = context.record.message.value;
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    return Buffer.from(value).toString('utf8');
  }
}
