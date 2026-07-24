/** Port of Benzene.HealthChecks.Disk.Extensions. */
import { addHealthCheckInstance, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { DiskHealthCheck } from './DiskHealthCheck';

/**
 * Registration helper for `DiskHealthCheck`. C# extension method becomes a free function.
 * Registers a check for the drive containing `path`: below `minimumFreeBytes` it fails, below the
 * optional `warningFreeBytes` (but at/above the minimum) it warns.
 *
 * C#'s `AddHealthCheck(instance)` maps to `addHealthCheckInstance`.
 */
export function addDiskSpaceCheck(
  builder: IHealthCheckBuilder,
  path: string,
  minimumFreeBytes: number,
  warningFreeBytes?: number,
): IHealthCheckBuilder {
  return addHealthCheckInstance(builder, new DiskHealthCheck(path, minimumFreeBytes, warningFreeBytes));
}
