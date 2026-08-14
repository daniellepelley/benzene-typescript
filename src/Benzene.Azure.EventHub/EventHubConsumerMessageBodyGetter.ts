/** Port of Benzene.Azure.EventHub.EventHubConsumerMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Extracts the event body from an event received by the self-hosted consumer as a string.
 *
 * MESSAGE-TYPE ADAPTATION: C# does `context.EventData.EventBody?.ToString()` on a `BinaryData` body.
 * `@azure/event-hubs` delivers `body` as `any` (already decoded), so this handles the shapes it can
 * arrive as — an existing `string` verbatim, binary (`Uint8Array`/`Buffer`) UTF-8 decoded, anything
 * else `String(...)`-coerced — mapping `undefined`/`null` to `undefined` (C# `?.`). Same approach as the
 * Service Bus consumer's body getter.
 */
export class EventHubConsumerMessageBodyGetter implements IMessageBodyGetter<EventHubConsumerContext> {
  getBody(context: EventHubConsumerContext): string | undefined {
    const body: unknown = context.eventData.body;
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
