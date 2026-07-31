import { describe, expect, it } from 'vitest';
import type { Channel, ChannelModel } from 'amqplib';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { HealthCheckStatus, IDependencyHealthCheck } from '@benzene/health-checks-core';
import { getHealthCheckerBuilder, IHealthCheckFinder } from '@benzene/health-checks';
import { useWorker, WorkerApplicationBuilder } from '@benzene/self-host';
import {
  addRabbitMqDependencyHealthCheck,
  IRabbitMqConnectionFactory,
  IRabbitMqConnectionProvider,
  RabbitMqHealthCheck,
  useRabbitMq,
} from '@benzene/rabbitmq';

/**
 * Ports Benzene.Test.RabbitMq.RabbitMqHealthCheckTest + RabbitMqAutoWireHealthCheckTest: the passive
 * `checkQueue` reachability probe (healthy on success, failed with the AMQP reply code on a channel
 * error, persistent on a 403 access-refused), plus the consumer-side auto-wiring
 * (`useRabbitMq(..., healthCheck = true)`) onto the dependency category, deduped by queue.
 */

/** A connection provider whose channel's `checkQueue` runs the supplied behaviour; `close` is a no-op. */
function providerWith(checkQueue: () => Promise<unknown>): IRabbitMqConnectionProvider {
  const channel = { checkQueue: () => checkQueue(), close: () => Promise.resolve() } as unknown as Channel;
  const connection = { createChannel: () => Promise.resolve(channel) } as unknown as ChannelModel;
  return { getConnectionAsync: () => Promise.resolve(connection) };
}

/** A connection factory that must never be opened — the auto-wire provider is lazy. */
const lazyFactory: IRabbitMqConnectionFactory = {
  createConnectionAsync: () => {
    throw new Error('the RabbitMq connection should not be opened at registration');
  },
};

describe('RabbitMqHealthCheck', () => {
  it('reports healthy on a passive queue declare, non-destructively, with the Queue dependency', async () => {
    const check = new RabbitMqHealthCheck(providerWith(() => Promise.resolve({ queue: 'orders' })), 'orders');
    expect(check.type).toBe('RabbitMq');

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.data.Queue).toBe('orders');
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: 'orders' }]);
  });

  it('reports failed with the 404 reply code when the queue is missing', async () => {
    const result = await new RabbitMqHealthCheck(
      providerWith(() => Promise.reject(Object.assign(new Error('NOT_FOUND'), { code: 404 }))),
      'orders',
    ).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.StatusCode).toBe(404);
    expect(result.data.ErrorCode).toBe('404');
    expect(result.isPersistent).toBe(false);
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: 'orders' }]);
  });

  it('classifies an access-refused (403) as a persistent failure', async () => {
    const result = await new RabbitMqHealthCheck(
      providerWith(() => Promise.reject(Object.assign(new Error('ACCESS_REFUSED'), { code: 403 }))),
      'orders',
    ).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.StatusCode).toBe(403);
  });

  it('reports failed when the broker is unreachable', async () => {
    const provider: IRabbitMqConnectionProvider = {
      getConnectionAsync: () => Promise.reject(new Error('connection refused')),
    };
    const result = await new RabbitMqHealthCheck(provider, 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: 'orders' }]);
  });
});

describe('RabbitMq consumer health-check auto-wiring', () => {
  it('registers a RabbitMq dependency check on the dependency category only', () => {
    const container = new DefaultBenzeneServiceContainer();
    addRabbitMqDependencyHealthCheck(container, { queueName: 'orders' }, lazyFactory);
    const scope = container.createServiceResolverFactory().createScope();
    const found = scope.getServices(IDependencyHealthCheck);
    scope.dispose();

    expect(found.map((c) => c.type)).toEqual(['RabbitMq']);
    expect(found.every((c) => c.isNonCritical === true)).toBe(true);
  });

  it('de-duplicates two registrations of the same queue into one check (via the finder)', () => {
    const container = new DefaultBenzeneServiceContainer();
    addRabbitMqDependencyHealthCheck(container, { queueName: 'orders' }, lazyFactory);
    addRabbitMqDependencyHealthCheck(container, { queueName: 'orders' }, lazyFactory);
    getHealthCheckerBuilder({ register: (action) => action(container) });

    const scope = container.createServiceResolverFactory().createScope();
    const deduped = scope.getService(IHealthCheckFinder).findDependencyHealthChecks();
    scope.dispose();
    expect(deduped).toHaveLength(1);
  });

  it('useRabbitMq auto-registers by default and opts out when healthCheck is false', () => {
    const checksFor = (healthCheck?: boolean): IDependencyHealthCheck[] => {
      const container = new DefaultBenzeneServiceContainer();
      const app: IBenzeneApplicationBuilder = new WorkerApplicationBuilder(container);
      useWorker(app, (workers) =>
        useRabbitMq(workers, { queueName: 'orders' }, lazyFactory, () => {}, healthCheck),
      );
      const scope = container.createServiceResolverFactory().createScope();
      const found = scope.getServices(IDependencyHealthCheck);
      scope.dispose();
      return found;
    };

    expect(checksFor().map((c) => c.type)).toEqual(['RabbitMq']);
    expect(checksFor(false)).toHaveLength(0);
  });
});
