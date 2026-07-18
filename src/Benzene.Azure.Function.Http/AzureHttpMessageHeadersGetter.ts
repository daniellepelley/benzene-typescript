import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { AzureHttpContext } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetMessageHeadersGetter.
 *
 * Extracts message headers, mapping a fixed set of well-known headers (`x-user-id`,
 * `x-correlation-id`) to shorter field names and passing all others through, with keys and values
 * lower-cased and duplicates resolved first-wins (C# `GroupBy(...).Select(x => x.First())`).
 *
 * FIELD MAPPING: C# `HttpRequest.Headers` (`IHeaderDictionary`) -> `@azure/functions`
 * `HttpRequest.headers`, a fetch-`Headers` object iterated with `forEach((value, key) => ...)`. Header
 * names on a `Headers` object are already lower-cased per the fetch spec, so the explicit
 * `ToLowerInvariant()` calls are preserved for parity but are effectively idempotent on the key.
 */
export class AzureHttpMessageHeadersGetter implements IMessageHeadersGetter<AzureHttpContext> {
  private readonly headerMapping: Record<string, string> = {
    'x-user-id': 'userId',
    'x-correlation-id': 'correlationId',
  };

  getHeaders(context: AzureHttpContext): Record<string, string> {
    const result: Record<string, string> = {};
    context.httpRequest.headers.forEach((value, key) => {
      const mappedKey = this.headerMapping[key.toLowerCase()] ?? key;
      const finalKey = mappedKey.toLowerCase();
      if (!(finalKey in result)) {
        result[finalKey] = value.toLowerCase();
      }
    });
    return result;
  }
}
