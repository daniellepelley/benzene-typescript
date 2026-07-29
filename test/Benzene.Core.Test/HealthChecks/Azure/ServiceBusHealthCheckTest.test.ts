import { describe, expect, it } from 'vitest';
import { ServiceBusClient, ServiceBusError, ServiceBusReceiver } from '@azure/service-bus';
import { HealthCheckStatus } from '@benzene/health-checks-core';
import { ServiceBusHealthCheck } from '@benzene/health-checks-azure-service-bus';

/**
 * Ports Benzene.Test.HealthChecks.Azure.ServiceBus.ServiceBusHealthCheckTest: a non-destructive
 * `peekMessages` reachability probe that is healthy on a successful round-trip (even against an empty
 * entity) and, on failure, classifies via the shared policy — an authorization denial is a persistent
 * failure, anything else transient — reporting the SDK failure reason, never the error message. The
 * `ServiceBusClient`/`ServiceBusReceiver` are stubbed; the receiver is closed in every case.
 *
 * PORT DIVERGENCE: the JS SDK folds C#'s `UnauthorizedAccessException`/`ServiceBusException` into a
 * single `ServiceBusError` (with a `code`), so the reported `Error` type name is `'ServiceBusError'`
 * (the JS class) rather than C#'s `'ServiceBusException'`.
 */

interface StubReceiver extends ServiceBusReceiver {
  closed: boolean;
}

/** A stub receiver whose `peekMessages` returns/throws whatever the test supplies; records `close()`. */
function stubReceiver(peek: () => Promise<unknown>): StubReceiver {
  const receiver = {
    closed: false,
    peekMessages: () => peek(),
    close() {
      receiver.closed = true;
      return Promise.resolve();
    },
  };
  return receiver as unknown as StubReceiver;
}

/** A stub client that hands out `receiver` for any `createReceiver` call. */
function stubClient(receiver: ServiceBusReceiver, fullyQualifiedNamespace = ''): ServiceBusClient {
  return {
    fullyQualifiedNamespace,
    createReceiver: () => receiver,
  } as unknown as ServiceBusClient;
}

describe('ServiceBusHealthCheck', () => {
  it('reports healthy on a successful queue peek, with the Queue dependency', async () => {
    const receiver = stubReceiver(() => Promise.resolve([])); // empty queue — still a successful round-trip
    const result = await new ServiceBusHealthCheck(stubClient(receiver), 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.type).toBe('ServiceBus');
    expect(result.data.Entity).toBe('orders');
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: 'orders' }]);
    expect(receiver.closed).toBe(true);
  });

  it('reports healthy on a successful subscription peek, with the Subscription dependency', async () => {
    const receiver = stubReceiver(() => Promise.resolve([]));
    const result = await new ServiceBusHealthCheck(stubClient(receiver), 'events', 'audit').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.ok);
    expect(result.dependencies).toEqual([{ kind: 'Subscription', name: 'events/audit' }]);
  });

  it('includes the fully-qualified namespace host when the client exposes one', async () => {
    const receiver = stubReceiver(() => Promise.resolve([]));
    const result = await new ServiceBusHealthCheck(
      stubClient(receiver, 'myns.servicebus.windows.net'),
      'orders',
    ).executeAsync();

    expect(result.data.Namespace).toBe('myns.servicebus.windows.net');
  });

  it('reports unhealthy on a peek failure, the error type not its message, keeping the dependency', async () => {
    const receiver = stubReceiver(() =>
      Promise.reject(new ServiceBusError('entity not found: super-secret-connection-detail', 'MessagingEntityNotFound')),
    );
    const result = await new ServiceBusHealthCheck(stubClient(receiver), 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.data.Error).toBe('ServiceBusError');
    expect(result.data.ErrorCode).toBe('MessagingEntityNotFound');
    expect(result.isPersistent).toBe(false);
    expect(result.dependencies).toEqual([{ kind: 'Queue', name: 'orders' }]);
    expect(JSON.stringify(result.data)).not.toContain('super-secret-connection-detail');
    expect(receiver.closed).toBe(true);
  });

  it('classifies an UnauthorizedAccess failure as a persistent failure with a 403', async () => {
    const receiver = stubReceiver(() =>
      Promise.reject(new ServiceBusError('no Listen claim', 'UnauthorizedAccess')),
    );
    const result = await new ServiceBusHealthCheck(stubClient(receiver), 'orders').executeAsync();

    expect(result.status).toBe(HealthCheckStatus.failed);
    expect(result.isPersistent).toBe(true);
    expect(result.data.ErrorCode).toBe('Unauthorized');
    expect(result.data.StatusCode).toBe(403);
  });

  it('closes the receiver even when peek throws', async () => {
    const receiver = stubReceiver(() =>
      Promise.reject(new ServiceBusError('boom', 'ServiceCommunicationProblem')),
    );
    await new ServiceBusHealthCheck(stubClient(receiver), 'orders').executeAsync();

    expect(receiver.closed).toBe(true);
  });
});
