import { describe, expect, it } from 'vitest';
import type { ServiceBusClient } from '@azure/service-bus';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { IDependencyHealthCheck } from '@benzenejs/health-checks-core';
import { getHealthCheckerBuilder, IHealthCheckFinder } from '@benzenejs/health-checks';
import { useWorker, WorkerApplicationBuilder } from '@benzenejs/self-host';
import {
  addServiceBusDependencyHealthCheck,
  BenzeneServiceBusConfig,
  IServiceBusClientFactory,
  useServiceBus,
} from '@benzenejs/azure-service-bus';

/**
 * Ports Benzene.Test.Azure.ServiceBusWorker.ServiceBusAutoWireHealthCheckTest: the consumer-side
 * `addServiceBusDependencyHealthCheck` (called by `useServiceBus(..., healthCheck = true)`) auto-registers
 * the peek-based reachability check on the DEPENDENCY category (deep `benzene:healthcheck` layer only), deduped by
 * the consumed entity. The client is never executed here — just registered — so a bare stub factory is
 * fine.
 */

const factory: IServiceBusClientFactory = { create: () => ({}) as unknown as ServiceBusClient };

/** Registers the given config's check and returns the raw dependency checks on the container. */
function dependencyChecks(config: BenzeneServiceBusConfig): IDependencyHealthCheck[] {
  const container = new DefaultBenzeneServiceContainer();
  addServiceBusDependencyHealthCheck(container, config, factory);
  const scope = container.createServiceResolverFactory().createScope();
  const found = scope.getServices(IDependencyHealthCheck);
  scope.dispose();
  return found;
}

describe('Service Bus consumer health-check auto-wiring', () => {
  it('registers a ServiceBus dependency check for a queue on the dependency category only', () => {
    const found = dependencyChecks({ queueName: 'orders' });
    expect(found.map((c) => c.type)).toEqual(['ServiceBus']);
    // A dependency check is non-critical: a broker blip degrades, it does not de-service liveness.
    expect(found.every((c) => c.isNonCritical === true)).toBe(true);
  });

  it('registers a ServiceBus dependency check for a topic subscription', () => {
    const found = dependencyChecks({ topicName: 'orders', subscriptionName: 'billing' });
    expect(found.map((c) => c.type)).toEqual(['ServiceBus']);
  });

  it('de-duplicates two registrations of the same entity into one check (via the finder)', () => {
    const container = new DefaultBenzeneServiceContainer();
    addServiceBusDependencyHealthCheck(container, { queueName: 'orders' }, factory);
    addServiceBusDependencyHealthCheck(container, { queueName: 'orders' }, factory);
    getHealthCheckerBuilder({ register: (action) => action(container) });

    const scope = container.createServiceResolverFactory().createScope();
    const deduped = scope.getService(IHealthCheckFinder).findDependencyHealthChecks();
    scope.dispose();
    expect(deduped).toHaveLength(1);
  });
});

describe('useServiceBus health-check flag', () => {
  /** Boots useServiceBus with the given flag and returns the dependency checks it registered. */
  function checksFor(healthCheck?: boolean): IDependencyHealthCheck[] {
    const container = new DefaultBenzeneServiceContainer();
    const app: IBenzeneApplicationBuilder = new WorkerApplicationBuilder(container);
    useWorker(app, (workers) =>
      useServiceBus(
        workers,
        { queueName: 'orders' },
        factory,
        () => {
          // no pipeline middleware needed for this registration-only assertion
        },
        healthCheck,
      ),
    );
    const scope = container.createServiceResolverFactory().createScope();
    const found = scope.getServices(IDependencyHealthCheck);
    scope.dispose();
    return found;
  }

  it('auto-registers the reachability check by default', () => {
    expect(checksFor().map((c) => c.type)).toEqual(['ServiceBus']);
  });

  it('opts out when healthCheck is false', () => {
    expect(checksFor(false)).toHaveLength(0);
  });
});
