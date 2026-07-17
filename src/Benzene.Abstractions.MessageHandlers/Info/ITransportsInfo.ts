import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Exposes the names of every transport registered with the application
 * (e.g. for diagnostics or startup logging).
 * Port of Benzene.Abstractions.MessageHandlers.Info.ITransportsInfo.
 */
export interface ITransportsInfo {
  /** The names of all registered transports. */
  readonly transports: string[];
}

export const ITransportsInfo: ServiceToken<ITransportsInfo> =
  serviceToken<ITransportsInfo>('ITransportsInfo');
