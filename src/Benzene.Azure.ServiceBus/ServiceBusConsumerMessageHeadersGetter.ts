/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';

/**
 * Extracts headers from a Service Bus message's string-typed application properties.
 *
 * MESSAGE-TYPE ADAPTATION: C#
 * `Message.ApplicationProperties.Where(x => x.Value is string).ToDictionary(...)` becomes a filter over
 * `message.applicationProperties` keeping only entries whose value is a `string`. Non-string properties
 * (numbers, booleans, dates) are dropped, matching the .NET filter.
 */
export class ServiceBusConsumerMessageHeadersGetter
  implements IMessageHeadersGetter<ServiceBusConsumerContext>
{
  getHeaders(context: ServiceBusConsumerContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const properties = context.message.applicationProperties;
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
