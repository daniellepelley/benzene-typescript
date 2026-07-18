import { IHttpHeaderMappings } from './IHttpHeaderMappings';

/**
 * The default `IHttpHeaderMappings` with no custom mappings: header names are used as-is.
 * Port of Benzene.Http.DefaultHttpHeaderMappings.
 */
export class DefaultHttpHeaderMappings implements IHttpHeaderMappings {
  getMappings(): Record<string, string> {
    return {};
  }
}
