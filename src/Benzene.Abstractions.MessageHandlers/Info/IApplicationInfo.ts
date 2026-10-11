import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

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

  /**
   * The comparison scheme of {@link version} (`integer`, `semver`, `lexicographic` - service-versions.md §2),
   * carried onto the Contract Document as `versionScheme`. Optional: absent means the version is an identity
   * only, not an order (the .NET `IApplicationInfo.VersionScheme` default member).
   */
  readonly versionScheme?: string;
}

export const IApplicationInfo: ServiceToken<IApplicationInfo> =
  serviceToken<IApplicationInfo>('IApplicationInfo');
