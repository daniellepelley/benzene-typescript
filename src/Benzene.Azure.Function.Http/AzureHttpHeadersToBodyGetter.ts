import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { AzureHttpContext } from './AzureHttpContext';

/**
 * Port of Benzene.Azure.Function.AspNet.AspNetHeadersToBodyGetter.
 *
 * Extracts a fixed set of HTTP headers (currently just `x-user-id`) and maps them to body-friendly
 * field names, for use by `AzureHttpContextRequestEnricher`. Only headers present in the fixed mapping
 * are emitted; duplicates resolve first-wins (C# `GroupBy(...).Select(x => x.First())`) and values are
 * passed through unchanged (not lower-cased, matching C#).
 *
 * FIELD MAPPING: C# `HttpRequest.Headers` -> `@azure/functions` `HttpRequest.headers` (a fetch
 * `Headers` object).
 */
export class AzureHttpHeadersToBodyGetter implements IMessageHeadersGetter<AzureHttpContext> {
  private readonly headerMapping: Record<string, string> = {
    'x-user-id': 'userId',
  };

  getHeaders(context: AzureHttpContext): Record<string, string> {
    const result: Record<string, string> = {};
    context.httpRequest.headers.forEach((value, key) => {
      const mappedKey = this.headerMapping[key.toLowerCase()];
      if (mappedKey !== undefined && !(mappedKey in result)) {
        result[mappedKey] = value;
      }
    });
    return result;
  }
}
