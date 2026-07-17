import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * Static, application-level metadata (as opposed to per-message ITransportInfo),
 * typically surfaced for diagnostics, health checks, or included in log context.
 * Port of Benzene.Abstractions.MessageHandlers.Info.IApplicationInfo.
 */
export interface IApplicationInfo {
  /** The application's name. */
  readonly name: string;

  /** A human-readable description of the application. */
  readonly description: string;

  /** The application's version. */
  readonly version: string;
}

export const IApplicationInfo: ServiceToken<IApplicationInfo> =
  serviceToken<IApplicationInfo>('IApplicationInfo');
