import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer, IRegisterDependency } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  addDependencyHealthCheck,
  DependencyHealthCheck,
  HealthCheckResponse,
  HealthCheckResult,
  HealthCheckStatus,
  IDependencyHealthCheck,
  IHealthCheck,
  IHealthCheckResult,
} from '@benzene/health-checks-core';
import { getHealthCheckerBuilder, HealthCheckProcessor, IHealthCheckFinder } from '@benzene/health-checks';

/**
 * Ports the dependency-category behaviour: an auto-wired external-dependency check is registered under
 * `IDependencyHealthCheck`, is non-critical by default, is de-duplicated by `dedupKey`, and is
 * harvested only by the general `healthcheck` probe (`includeDependencyChecks`) — never by
 * liveness/readiness.
 */

class QueueCheck implements IHealthCheck {
  constructor(private readonly name: string) {}
  readonly type = 'SqsQueue';
  executeAsync(): Promise<IHealthCheckResult> {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type, { queue: this.name }));
  }
}

function registerFor(container: IBenzeneServiceContainer): IRegisterDependency {
  return { register: (action) => action(container) };
}

describe('DependencyHealthCheck', () => {
  it('is non-critical and delegates type/execute to the inner check', async () => {
    const dep = new DependencyHealthCheck(new QueueCheck('orders'), 'SqsQueue:orders');
    expect(dep.type).toBe('SqsQueue');
    expect(dep.isNonCritical).toBe(true);
    expect(dep.dedupKey).toBe('SqsQueue:orders');
    const result = await dep.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
  });

  it('falls back to the inner type as its dedupKey when none is given', () => {
    expect(new DependencyHealthCheck(new QueueCheck('x')).dedupKey).toBe('SqsQueue');
  });

  it('the finder de-duplicates dependency checks by dedupKey', () => {
    const container = new DefaultBenzeneServiceContainer();
    // Two registrations of the *same* dependency (same dedupKey) collapse to one.
    addDependencyHealthCheck(container, () => new QueueCheck('orders'), 'SqsQueue:orders');
    addDependencyHealthCheck(container, () => new QueueCheck('orders'), 'SqsQueue:orders');
    addDependencyHealthCheck(container, () => new QueueCheck('payments'), 'SqsQueue:payments');
    getHealthCheckerBuilder(registerFor(container));

    const scope = container.createServiceResolverFactory().createScope();
    const found = scope.getService(IHealthCheckFinder).findDependencyHealthChecks();
    scope.dispose();

    expect(found.map((c) => (c as IDependencyHealthCheck).dedupKey).sort()).toEqual([
      'SqsQueue:orders',
      'SqsQueue:payments',
    ]);
  });

  it('dependency checks are harvested by the general probe but excluded from liveness/readiness', () => {
    const container = new DefaultBenzeneServiceContainer();
    addDependencyHealthCheck(container, () => new QueueCheck('orders'), 'SqsQueue:orders');
    const builder = getHealthCheckerBuilder(registerFor(container));

    const scope = container.createServiceResolverFactory().createScope();
    // healthcheck probe includes dependency checks…
    expect(builder.getHealthChecks(scope, true)).toHaveLength(1);
    // …liveness/readiness (includeDependencyChecks=false) do not.
    expect(builder.getHealthChecks(scope, false)).toHaveLength(0);
    scope.dispose();
  });

  it('an unreachable dependency degrades the general probe to a warning, not unhealthy', async () => {
    const failingDep: IHealthCheck = {
      type: 'SqsQueue',
      isNonCritical: true,
      executeAsync: () => Promise.resolve(HealthCheckResult.createInstance(false, 'SqsQueue')),
    };

    const result = (await HealthCheckProcessor.performHealthChecksAsync('healthcheck', [
      new DependencyHealthCheck(failingDep, 'SqsQueue:orders'),
    ])) as IBenzeneResultOf<HealthCheckResponse>;

    expect(result.payload.isHealthy).toBe(true);
    expect(result.payload.healthChecks.SqsQueue.status).toBe(HealthCheckStatus.warning);
  });
});
