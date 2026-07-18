import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Maps a Benzene result-status string to an HTTP status-code string (e.g. `"Ok"` -> `"200"`).
 * Port of Benzene.Http.IHttpStatusCodeMapper.
 */
export interface IHttpStatusCodeMapper {
  /** Maps a Benzene result status to an HTTP status code (as a string). Port of C# `Map`. */
  map(benzeneResultStatus: string | undefined): string;
}

export const IHttpStatusCodeMapper: ServiceToken<IHttpStatusCodeMapper> =
  serviceToken<IHttpStatusCodeMapper>('IHttpStatusCodeMapper');
