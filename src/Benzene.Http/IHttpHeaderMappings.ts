import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Maps custom header names to standard HTTP header names, so transports using different header
 * conventions can be handled uniformly.
 * Port of Benzene.Http.IHttpHeaderMappings (C# `IDictionary<string, string>` maps to `Record<string, string>`).
 */
export interface IHttpHeaderMappings {
  /** Returns the header-name mappings (custom name -> HTTP header name). Port of C# `GetMappings`. */
  getMappings(): Record<string, string>;
}

export const IHttpHeaderMappings: ServiceToken<IHttpHeaderMappings> =
  serviceToken<IHttpHeaderMappings>('IHttpHeaderMappings');
