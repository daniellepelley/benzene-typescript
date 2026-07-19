/** Port of Benzene.Cache.Core.ICacheService. */
import { ServiceToken, serviceToken } from '@benzene/abstractions';

/**
 * A cache backend that can report whether it is reachable.
 * Port of Benzene.Cache.Core.ICacheService.
 *
 * Resolved from the container (e.g. by the health-check factory in .NET), so it declares a
 * merged `ServiceToken` of the same name per the port's service-resolution convention.
 */
export interface ICacheService {
  /** Port of C# `Task<bool> CanConnectAsync()`. */
  canConnectAsync(): Promise<boolean>;
}

export const ICacheService: ServiceToken<ICacheService> =
  serviceToken<ICacheService>('ICacheService');
