import { describe, expect, it } from 'vitest';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import { CacheHealthCheck, ICacheService } from '@benzene/cache-core';

/**
 * Ports test/Benzene.Core.Test/Cache/CacheHealthCheckTest.cs. The C# generic `CacheHealthCheck<T>` +
 * mocked `ICacheService` become the single-token `CacheHealthCheck` over a fake `ICacheService`.
 */

class FakeCacheService implements ICacheService {
  constructor(private readonly result: boolean | Error) {}

  canConnectAsync(): Promise<boolean> {
    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }
}

describe('CacheHealthCheck', () => {
  it('returns healthy when it can connect', async () => {
    const healthCheck = new CacheHealthCheck(new FakeCacheService(true));

    const result = await healthCheck.executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(healthCheck.type).toBe('Cache');
    expect(result.data.CanConnect).toBe(true);
    expect(result.dependencies).toHaveLength(1);
    expect(result.dependencies[0]!.kind).toBe('Cache');
    // Dependency name defaults to the concrete service's class name (the JS analog of typeof(T).Name).
    expect(result.dependencies[0]!.name).toBe('FakeCacheService');
  });

  it('returns unhealthy when it cannot connect (no error thrown)', async () => {
    const result = await new CacheHealthCheck(new FakeCacheService(false)).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.CanConnect).toBe(false);
    expect(result.data.Error).toBeUndefined();
  });

  it('returns failed with the error TYPE name (never its message) when the probe throws', async () => {
    // The C# test throws an error whose message carries a secret to prove only the type name is reported.
    class RedisConnectionError extends Error {}
    const healthCheck = new CacheHealthCheck(
      new FakeCacheService(new RedisConnectionError('connection string with a secret in it')),
    );

    const result = await healthCheck.executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.CanConnect).toBe(false);
    expect(result.data.Error).toBe('RedisConnectionError');
  });

  it('uses an explicit dependency name when supplied', async () => {
    const result = await new CacheHealthCheck(new FakeCacheService(true), 'redis-primary').executeAsync();

    expect(result.dependencies[0]!.name).toBe('redis-primary');
  });
});
