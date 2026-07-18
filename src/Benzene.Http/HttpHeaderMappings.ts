import { IHttpHeaderMappings } from './IHttpHeaderMappings';

/**
 * A configurable `IHttpHeaderMappings` whose mappings are supplied at construction.
 * Port of Benzene.Http.HttpHeaderMappings (C# `IDictionary<string, string>` maps to `Record<string, string>`).
 */
export class HttpHeaderMappings implements IHttpHeaderMappings {
  constructor(private readonly mappings: Record<string, string>) {}

  getMappings(): Record<string, string> {
    return this.mappings;
  }
}
