/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { RabbitMqContext } from './RabbitMqContext';

/**
 * Extracts headers from a RabbitMQ delivery's `properties.headers`, decoding the entries RabbitMQ carries
 * on the wire. This means header-based decorators — correlation id, W3C trace context, payload version —
 * work on this transport exactly as on the others.
 *
 * MESSAGE-TYPE ADAPTATION: C# iterates `BasicProperties.Headers` (values arrive as `byte[]`, decoded to a
 * UTF-8 string, with raw strings accepted too). amqplib exposes headers as `message.properties.headers`
 * (a plain object) and, after decoding AMQP field values, string-valued headers arrive as JS `string`s
 * while byte-array headers arrive as `Buffer`s — so this decodes a `Buffer` as UTF-8, passes a `string`
 * through, and `String(...)`-coerces anything else, skipping `null`/`undefined` (matching the C# skip of
 * a null header value).
 */
export class RabbitMqMessageHeadersGetter implements IMessageHeadersGetter<RabbitMqContext> {
  getHeaders(context: RabbitMqContext): Record<string, string> {
    const result: Record<string, string> = {};
    const headers = context.message.properties.headers;
    if (headers === undefined || headers === null) {
      return result;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined || value === null) {
        continue;
      }
      result[key] = decode(value);
    }
    return result;
  }
}

function decode(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return String(value);
}
