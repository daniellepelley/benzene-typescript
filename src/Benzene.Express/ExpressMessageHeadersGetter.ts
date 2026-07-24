import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { DictionaryUtils } from '@benzene/core';
import { IHttpHeaderMappings } from '@benzene/http';
import { ExpressContext } from './ExpressContext';

/**
 * Extracts headers from an Express request, applying the configured `IHttpHeaderMappings` (which rename
 * header names to their mapped values). Express analog of `Benzene.AspNet.Core.AspNetMessageHeadersGetter`.
 */
export class ExpressMessageHeadersGetter implements IMessageHeadersGetter<ExpressContext> {
  constructor(private readonly httpHeaderMappings: IHttpHeaderMappings) {}

  getHeaders(context: ExpressContext): Record<string, string> {
    return DictionaryUtils.replace(context.headers, this.httpHeaderMappings.getMappings());
  }
}
