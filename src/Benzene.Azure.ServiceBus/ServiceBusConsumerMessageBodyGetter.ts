/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';

/**
 * Extracts the message body from a Service Bus message received by the self-hosted consumer.
 *
 * MESSAGE-TYPE ADAPTATION: C# does `context.Message.Body?.ToString()` on a `BinaryData` body.
 * `@azure/service-bus` delivers `body` as `any` (already decoded per content type), so this handles
 * the shapes it can arrive as — an existing `string` verbatim, binary (`Uint8Array`/`Buffer`) UTF-8
 * decoded (the closest analogue to `BinaryData.ToString()`), anything else `String(...)`-coerced —
 * mapping `undefined`/`null` to `undefined` (C# `?.`). Same as `@benzenejs/azure-function-service-bus`.
 */
export class ServiceBusConsumerMessageBodyGetter implements IMessageBodyGetter<ServiceBusConsumerContext> {
  getBody(context: ServiceBusConsumerContext): string | undefined {
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
