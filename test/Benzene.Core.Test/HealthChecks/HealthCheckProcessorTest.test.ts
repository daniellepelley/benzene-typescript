import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer, IRegisterDependency } from '@benzene/abstractions';
import { BenzeneResultStatus } from '@benzene/results';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  HealthCheckDependency,
  HealthCheckResult,
  HealthCheckResponse,
  HealthCheckStatus,
  IHealthCheck,
  IHealthCheckResult,
  addHealthCheckInstance,
} from '@benzene/health-checks-core';
import {
  getHealthCheckerBuilder,
  HealthCheckProcessor,
  IHealthCheckFinder,
} from '@benzene/health-checks';

/**
 * Ports the spirit of the C# health-check tests: register a couple of fake `IHealthCheck`s (one
 * healthy, one unhealthy) in a `DefaultBenzeneServiceContainer`, discover them through the
 * DI-registration substitution (`HealthCheckFinder` resolving `getServices(IHealthCheck)`), run the
 * aggregator, and assert the overall response and per-check results.
 */

class HealthyCheck implements IHealthCheck {
  readonly type = 'Alpha';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(
      HealthCheckResult.createInstance(true, this.type, { detail: 'up' }, [
        new HealthCheckDependency('Queue', 'alpha-queue'),
      ]),
    );
  }
}

class UnhealthyCheck implements IHealthCheck {
  readonly type = 'Beta';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(false, this.type));
  }
}

/** An `IRegisterDependency` that applies each registration action straight to the container. */
function registerFor(container: IBenzeneServiceContainer): IRegisterDependency {
  return { register: (action) => action(container) };
}

describe('HealthCheckProcessor', () => {
  it('PerformHealthChecks_MixedChecksDiscoveredViaContainer_IsUnhealthyAndListsEach', async () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addScopedFactory(IHealthCheck, () => new HealthyCheck());
    container.addScopedFactory(IHealthCheck, () => new UnhealthyCheck());

    // Builder registers the IHealthCheckFinder whose factory resolves getServices(IHealthCheck).
    const builder = getHealthCheckerBuilder(registerFor(container));

    const scope = container.createServiceResolverFactory().createScope();
    // Sanity: the finder discovers both container-registered checks.
    expect(scope.getService(IHealthCheckFinder).findHealthChecks()).toHaveLength(2);

    const checks = builder.getHealthChecks(scope);
    const result = (await HealthCheckProcessor.performHealthChecksAsync(
      'healthcheck',
      checks,
    )) as IBenzeneResultOf<HealthCheckResponse>;
    scope.dispose();

    // One check failed -> overall unhealthy, mapped to ServiceUnavailable (HTTP 503) but still
    // flagged successful so the report body renders.
    expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
    expect(result.isSuccessful).toBe(true);

    const response = result.payload;
    expect(response.isHealthy).toBe(false);

    // Each dependency's result is listed, keyed by its type.
    expect(response.healthChecks.Alpha.status).toBe(HealthCheckStatus.ok);
    expect(response.healthChecks.Alpha.data.detail).toBe('up');
    expect(response.healthChecks.Alpha.dependencies).toEqual([
      new HealthCheckDependency('Queue', 'alpha-queue'),
    ]);
    expect(response.healthChecks.Beta.status).toBe(HealthCheckStatus.failed);
  });

  it('PerformHealthChecks_AllHealthyViaInlineBuilder_IsOk', async () => {
    const container = new DefaultBenzeneServiceContainer();
    const builder = getHealthCheckerBuilder(registerFor(container));
    addHealthCheckInstance(builder, new HealthyCheck());

    const scope = container.createServiceResolverFactory().createScope();
    const result = (await HealthCheckProcessor.performHealthChecksAsync(
      'healthcheck',
      builder.getHealthChecks(scope),
    )) as IBenzeneResultOf<HealthCheckResponse>;
    scope.dispose();

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect(result.payload.isHealthy).toBe(true);
    expect(result.payload.healthChecks.Alpha.status).toBe(HealthCheckStatus.ok);
  });

  it('PerformHealthChecks_WarningDoesNotFlipToUnhealthy', async () => {
    const warningCheck: IHealthCheck = {
      type: 'Cautious',
      executeAsync: () => Promise.resolve(HealthCheckResult.createWarning('Cautious')),
    };

    const result = (await HealthCheckProcessor.performHealthChecksAsync('healthcheck', [
      warningCheck,
    ])) as IBenzeneResultOf<HealthCheckResponse>;

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload.isHealthy).toBe(true);
    expect(result.payload.healthChecks.Cautious.status).toBe(HealthCheckStatus.warning);
  });

  it('PerformHealthChecks_CheckThatThrows_IsReportedFailedNotPropagated', async () => {
    const throwingCheck: IHealthCheck = {
      type: 'Boom',
      executeAsync: () => {
        throw new Error('kaboom');
      },
    };

    const result = (await HealthCheckProcessor.performHealthChecksAsync('healthcheck', [
      throwingCheck,
    ])) as IBenzeneResultOf<HealthCheckResponse>;

    expect(result.payload.isHealthy).toBe(false);
    expect(result.payload.healthChecks.Boom.status).toBe(HealthCheckStatus.failed);
    expect(result.payload.healthChecks.Boom.data.Exception).toBe('Error');
  });
});
