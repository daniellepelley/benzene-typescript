/** Port of Benzene.HealthChecks.Disk.DiskHealthCheck. */
import { statfs } from 'node:fs/promises';
import {
  HealthCheckDependency,
  HealthCheckResult,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';

/**
 * A host self-check on free disk space for the drive containing a given path. Reports
 * `failed` below a hard minimum, an optional `warning` below a soft threshold (degraded-but-not-fatal,
 * does not flip aggregate `isHealthy`), otherwise healthy.
 *
 * `System.IO.DriveInfo` -> `node:fs`'s `statfs`: `AvailableFreeSpace` is `bavail * bsize` and
 * `TotalSize` is `blocks * bsize`. `statfs` exposes no mount/drive name (there is no `DriveInfo.Name`
 * equivalent), so the checked `path` stands in as the drive identifier in the dependency and data.
 * The byte counts are `number` (the `TargetFramework` runs on 64-bit doubles, exact for real disk
 * sizes) rather than C#'s `long`.
 */
export class DiskHealthCheck implements IHealthCheck {
  constructor(
    private readonly path: string,
    private readonly minimumFreeBytes: number,
    private readonly warningFreeBytes?: number,
  ) {}

  get type(): string {
    return 'Disk';
  }

  async executeAsync(): Promise<IHealthCheckResult> {
    try {
      const stats = await statfs(this.path);
      const free = stats.bavail * stats.bsize;
      const total = stats.blocks * stats.bsize;

      const dependencies = [new HealthCheckDependency('Disk', this.path)];
      const data: Record<string, unknown> = {
        Drive: this.path,
        FreeBytes: free,
        TotalBytes: total,
        MinimumFreeBytes: this.minimumFreeBytes,
      };

      if (free < this.minimumFreeBytes) {
        return HealthCheckResult.createInstance(false, this.type, data, dependencies);
      }

      if (this.warningFreeBytes !== undefined && free < this.warningFreeBytes) {
        return HealthCheckResult.createWarning(this.type, data, dependencies);
      }

      return HealthCheckResult.createInstance(true, this.type, data, dependencies);
    } catch (ex) {
      return HealthCheckResult.createInstance(false, this.type, {
        Path: this.path,
        Error: errorName(ex),
      });
    }
  }
}

/** Mirrors C#'s `ex.GetType().Name` - the constructor name of the thrown value. */
function errorName(ex: unknown): string {
  if (ex instanceof Error) {
    return ex.name;
  }
  return typeof ex;
}
