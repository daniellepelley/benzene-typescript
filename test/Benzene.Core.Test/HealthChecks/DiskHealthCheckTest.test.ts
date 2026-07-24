import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import { DiskHealthCheck } from '@benzene/health-checks-disk';

/**
 * Ports test/Benzene.Core.Test/HealthChecks/Disk/DiskHealthCheckTest.cs. `Path.GetTempPath()` becomes
 * `os.tmpdir()`; the thresholds use `Number.MAX_SAFE_INTEGER` where C# used `long.MaxValue` (both are
 * "no real drive has this much free space").
 */

const path = tmpdir();

describe('DiskHealthCheck', () => {
  it('ExecuteAsync_AmpleFreeSpace_ReturnsHealthy', async () => {
    const result = await new DiskHealthCheck(path, 0).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.kind).toBe('Disk');
    expect('FreeBytes' in result.data).toBe(true);
  });

  it('ExecuteAsync_BelowMinimum_ReturnsFailed', async () => {
    const result = await new DiskHealthCheck(path, Number.MAX_SAFE_INTEGER).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
  });

  it('ExecuteAsync_BelowWarningButAboveMinimum_ReturnsWarning', async () => {
    // Warn threshold impossibly high, min zero -> free space is >= min but < warn -> Warning.
    const result = await new DiskHealthCheck(path, 0, Number.MAX_SAFE_INTEGER).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.warning);
  });
});
