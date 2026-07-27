/** Port of Benzene.Kafka.Core.Kafka.KafkaMessageBodyGetter (class `KafkaSendMessageBodyGetter`). */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * Reads the message value off a {@link KafkaSendMessageContext} as a string — the send-side counterpart
 * of the inbound `KafkaMessageBodyGetter`.
 *
 * MESSAGE-TYPE ADAPTATION: C# returns the `string` value directly (the send message is `Message<string,
 * string>`). kafkajs's `Message.value` is typed `Buffer | string | null`, so a `Buffer` is UTF-8 decoded,
 * a `string` passes through, and `null` maps to `undefined` (C# `null`).
 */
export class KafkaSendMessageBodyGetter implements IMessageBodyGetter<KafkaSendMessageContext> {
  getBody(context: KafkaSendMessageContext): string | undefined {
    const value = context.message.value;
    if (value === null || value === undefined) {
      return undefined;
    }
    return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
  }
}
