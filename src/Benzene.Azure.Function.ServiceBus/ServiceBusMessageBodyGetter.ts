/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { ServiceBusContext } from './ServiceBusContext';

/**
 * Extracts the message body from a Service Bus message as a string.
 *
 * MESSAGE-TYPE ADAPTATION: C# does `context.Message.Body?.ToString()` on a `BinaryData` body, which
 * decodes the raw bytes to their string form. `@azure/service-bus` delivers `body` as `any` (already
 * decoded per the message's content type), so this handles the shapes it can arrive as: an existing
 * `string` is returned verbatim, binary (`Uint8Array`/`Buffer`) is UTF-8 decoded (the closest analogue
 * to `BinaryData.ToString()`), and anything else is `String(...)`-coerced. `undefined`/`null` bodies
 * map to `undefined` (C# `?.`).
 */
export class ServiceBusMessageBodyGetter implements IMessageBodyGetter<ServiceBusContext> {
  getBody(context: ServiceBusContext): string | undefined {
    const body: unknown = context.message.body;
    if (body === undefined || body === null) {
      return undefined;
    }
    if (typeof body === 'string') {
      return body;
    }
    if (body instanceof Uint8Array) {
      return Buffer.from(body).toString('utf8');
    }
    return String(body);
  }
}
