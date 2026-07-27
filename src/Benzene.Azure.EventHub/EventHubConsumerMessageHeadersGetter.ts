/** Port of Benzene.Azure.EventHub.EventHubConsumerMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Extracts headers from an event's string-typed properties.
 *
 * MESSAGE-TYPE ADAPTATION: C# `EventData.Properties.Where(x => x.Value is string).ToDictionary(...)`
 * becomes a filter over `eventData.properties` keeping only entries whose value is a `string`.
 * Non-string properties (numbers, booleans, dates) are dropped, matching the .NET filter.
 */
export class EventHubConsumerMessageHeadersGetter
  implements IMessageHeadersGetter<EventHubConsumerContext>
{
  getHeaders(context: EventHubConsumerContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const properties = context.eventData.properties;
    if (properties !== undefined) {
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string') {
          headers[key] = value;
        }
      }
    }
    return headers;
  }
}
