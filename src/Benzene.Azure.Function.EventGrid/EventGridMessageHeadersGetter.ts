/** Port of Benzene.Azure.Function.EventGrid.EventGridMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { EventGridContext } from './EventGridContext';

/**
 * Surfaces an Event Grid event's envelope fields (`id`, `subject`, `source`) as message headers, so
 * middleware and handlers can reach them without the transport context. Only fields present on the
 * event are included, exactly as C#.
 */
export class EventGridMessageHeadersGetter implements IMessageHeadersGetter<EventGridContext> {
  getHeaders(context: EventGridContext): Record<string, string> {
    const headers: Record<string, string> = {};

    if (context.event.id !== undefined) {
      headers['id'] = context.event.id;
    }

    if (context.event.subject !== undefined) {
      headers['subject'] = context.event.subject;
    }

    if (context.event.source !== undefined) {
      headers['source'] = context.event.source;
    }

    return headers;
  }
}
