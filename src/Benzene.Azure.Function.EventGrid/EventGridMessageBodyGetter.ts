/** Port of Benzene.Azure.Function.EventGrid.EventGridMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { EventGridContext } from './EventGridContext';

/**
 * Extracts the message body from an Event Grid event — its `data` payload as raw JSON, which the request
 * mapper then deserializes into the handler's request type.
 *
 * FAITHFUL to the C# `context.Event.Data?.GetRawText() ?? "{}"`: an absent `data` (`undefined`) falls
 * back to `{}` (so handlers with empty request types still bind); a present payload is re-serialized
 * with `JSON.stringify` (a present JSON `null` yields `"null"`, exactly as `GetRawText()` would).
 */
export class EventGridMessageBodyGetter implements IMessageBodyGetter<EventGridContext> {
  getBody(context: EventGridContext): string {
    return context.event.data === undefined ? '{}' : JSON.stringify(context.event.data);
  }
}
