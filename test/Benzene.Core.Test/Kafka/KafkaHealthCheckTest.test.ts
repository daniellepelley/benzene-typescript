import { describe, expect, it } from 'vitest';
import type { Admin } from 'kafkajs';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { HealthCheckStatus, IDependencyHealthCheck } from '@benzene/health-checks-core';
import { getHealthCheckerBuilder, IHealthCheckFinder } from '@benzene/health-checks';
import { useWorker, WorkerApplicationBuilder } from '@benzene/self-host';
import {
  addKafkaDependencyHealthCheck,
  IKafkaAdminClientFactory,
  IKafkaConsumerFactory,
  KafkaHealthCheck,
  useKafka,
} from '@benzene/kafka-core';

/**
 * Ports Benzene.Test.Kafka.KafkaHealthCheckTest + KafkaAutoWireHealthCheckTest: the read-only metadata
 * reachability probe (healthy when the brokers are reachable and every subscribed topic is present, failed
 * naming a missing topic, failed with the Kafka error type on an unreachable broker, persistent on an
 * authorization failure), plus the consumer-side auto-wiring onto the dependency category, deduped by the
 * bootstrap servers.
 *
 * PORT DIVERGENCE: the TS `KafkaHealthCheck` takes the bootstrap servers off the
 * `IKafkaAdminClientFactory` (the config has no broker settings), not as a separate constructor argument.
 */

const brokers = 'broker1:9092,broker2:9092';

/** An admin factory whose fetched cluster carries `topics`; connect/disconnect are no-ops. */
function factoryReturning(topics: string[]): IKafkaAdminClientFactory {
  const admin = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    describeCluster: () => Promise.resolve({ brokers: [{ nodeId: 0, host: 'broker1', port: 9092 }] }),
    fetchTopicMetadata: () => Promise.resolve({ topics: topics.map((name) => ({ name, partitions: [] })) }),
  } as unknown as Admin;
  return { bootstrapServers: brokers, create: () => admin };
}

/** An admin factory whose metadata read rejects with `error`. */
function factoryThrowing(error: unknown): IKafkaAdminClientFactory {
  const admin = {
    connect: () => Promise.resolve(),
    disconnect: () => Promise.resolve(),
    describeCluster: () => Promise.reject(error),
    fetchTopicMetadata: () => Promise.reject(error),
  } as unknown as Admin;
  return { bootstrapServers: brokers, create: () => admin };
}

/** A consumer factory that is never invoked at registration time. */
const noopConsumerFactory: IKafkaConsumerFactory = {
  create: () => {
    throw new Error('the Kafka consumer should not be created at registration');
  },
};

describe('KafkaHealthCheck', () => {
  it('reports healthy when the brokers are reachable and every topic is present, with the dependencies', async () => {
    const check = new KafkaHealthCheck(factoryReturning(['orders', 'invoices']), ['orders', 'invoices']);
    expect(check.type).toBe('Kafka');

    const result = await check.executeAsync();
    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toContainEqual({ kind: 'Broker', name: brokers });
    expect(result.dependencies).toContainEqual({ kind: 'Topic', name: 'orders' });
    expect(result.dependencies).toContainEqual({ kind: 'Topic', name: 'invoices' });
    expect(result.data.Brokers).toBe(1);
  });

  it('reports failed naming the subscribed topic that is missing from the cluster', async () => {
    const result = await new KafkaHealthCheck(factoryReturning(['orders']), ['orders', 'invoices']).executeAsync();
    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(String(result.data.MissingTopics)).toContain('invoices');
  });

  it('reports failed with the Kafka error type when the broker is unreachable', async () => {
    const result = await new KafkaHealthCheck(
      factoryThrowing(Object.assign(new Error('broker down'), { type: 'BROKER_NOT_AVAILABLE' })),
      ['orders'],
    ).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.ErrorCode).toBe('BROKER_NOT_AVAILABLE');
    expect(result.isPersistent).toBe(false);
  });

  it('classifies an authorization failure as a persistent failure', async () => {
    const result = await new KafkaHealthCheck(
      factoryThrowing(Object.assign(new Error('no acl'), { type: 'CLUSTER_AUTHORIZATION_FAILED' })),
      ['orders'],
    ).executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.ErrorCode).toBe('CLUSTER_AUTHORIZATION_FAILED');
  });
});

describe('Kafka consumer health-check auto-wiring', () => {
  it('registers a Kafka dependency check on the dependency category only', () => {
    const container = new DefaultBenzeneServiceContainer();
    addKafkaDependencyHealthCheck(container, { topics: ['orders'] }, factoryReturning([]));
    const scope = container.createServiceResolverFactory().createScope();
    const found = scope.getServices(IDependencyHealthCheck);
    scope.dispose();

    expect(found.map((c) => c.type)).toEqual(['Kafka']);
    expect(found.every((c) => c.isNonCritical === true)).toBe(true);
  });

  it('de-duplicates two registrations of the same cluster into one check (via the finder)', () => {
    const container = new DefaultBenzeneServiceContainer();
    addKafkaDependencyHealthCheck(container, { topics: ['orders'] }, factoryReturning([]));
    addKafkaDependencyHealthCheck(container, { topics: ['invoices'] }, factoryReturning([]));
    getHealthCheckerBuilder({ register: (action) => action(container) });

    const scope = container.createServiceResolverFactory().createScope();
    const deduped = scope.getService(IHealthCheckFinder).findDependencyHealthChecks();
    scope.dispose();
    expect(deduped).toHaveLength(1);
  });

  it('useKafka wires the check when an admin factory is given, and only then', () => {
    const checksFor = (admin?: IKafkaAdminClientFactory, healthCheck?: boolean): IDependencyHealthCheck[] => {
      const container = new DefaultBenzeneServiceContainer();
      const app: IBenzeneApplicationBuilder = new WorkerApplicationBuilder(container);
      useWorker(app, (workers) =>
        useKafka(workers, { topics: ['orders'] }, noopConsumerFactory, () => {}, admin, healthCheck),
      );
      const scope = container.createServiceResolverFactory().createScope();
      const found = scope.getServices(IDependencyHealthCheck);
      scope.dispose();
      return found;
    };

    expect(checksFor(factoryReturning([])).map((c) => c.type)).toEqual(['Kafka']); // admin given, default on
    expect(checksFor(factoryReturning([]), false)).toHaveLength(0); // explicit opt-out
    expect(checksFor(undefined)).toHaveLength(0); // no admin factory -> no check
  });
});
