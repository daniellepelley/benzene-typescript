import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ServiceBusClient,
  ServiceBusReceivedMessage,
  ServiceBusSessionReceiverOptions,
} from '@azure/service-bus';
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { addBenzene } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';
import {
  addServiceBusConsumer,
  BenzeneServiceBusConfig,
  BenzeneServiceBusWorker,
  IServiceBusClientFactory,
  ServiceBusConsumerAckMode,
  ServiceBusConsumerApplication,
  ServiceBusConsumerContext,
  ServiceBusSettlement,
  ServiceBusSettlementHolder,
} from '@benzene/azure-service-bus';

/**
 * Covers the session pump — the BEND that replaces .NET's `ServiceBusSessionProcessor` (which the JS
 * SDK has no equivalent for) with a bounded `client.acceptNextSession(...)` loop. Drives the pump over
 * a FAKE `ServiceBusClient` whose `acceptNextSession` returns fake session receivers (each with the same
 * `subscribe`/settle shape as the non-session `FakeReceiver` in ServiceBusConsumerTest), asserting that:
 * sessions use `acceptNextSession` (not `createReceiver`); a session message is settled through the SAME
 * ack logic; the pump runs up to `maxConcurrentSessions` slots; a "no session available" rejection is
 * retried without killing the pump; and `stopAsync` stops the pump and closes the session receivers.
 * All fakes, no live broker; the pump loops terminate deterministically because the worker is stopped.
 */

const NO_SESSION_BACKOFF_MS = 1000;

function message(
  fields: Partial<Pick<ServiceBusReceivedMessage, 'messageId' | 'body' | 'applicationProperties'>>,
): ServiceBusReceivedMessage {
  return fields as unknown as ServiceBusReceivedMessage;
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/** A fake `ServiceBusSessionReceiver`: captures the subscribe handlers and records settle operations. */
class FakeSessionReceiver {
  readonly settled: { op: string; messageId: ServiceBusReceivedMessage['messageId']; options?: unknown }[] = [];
  processMessage: ((message: ServiceBusReceivedMessage) => Promise<void>) | undefined;
  processError: ((args: unknown) => Promise<void>) | undefined;
  closed = false;

  constructor(readonly sessionId: string) {}

  subscribe(
    handlers: {
      processMessage: (m: ServiceBusReceivedMessage) => Promise<void>;
      processError: (args: unknown) => Promise<void>;
    },
    _options?: unknown,
  ): { close(): Promise<void> } {
    this.processMessage = handlers.processMessage;
    this.processError = handlers.processError;
    return { close: () => Promise.resolve() };
  }
  completeMessage(m: ServiceBusReceivedMessage): Promise<void> {
    this.settled.push({ op: 'complete', messageId: m.messageId });
    return Promise.resolve();
  }
  abandonMessage(m: ServiceBusReceivedMessage): Promise<void> {
    this.settled.push({ op: 'abandon', messageId: m.messageId });
    return Promise.resolve();
  }
  deadLetterMessage(m: ServiceBusReceivedMessage, options?: unknown): Promise<void> {
    this.settled.push({ op: 'deadletter', messageId: m.messageId, options });
    return Promise.resolve();
  }
  deferMessage(m: ServiceBusReceivedMessage): Promise<void> {
    this.settled.push({ op: 'defer', messageId: m.messageId });
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/** A fake `ServiceBusClient` whose `acceptNextSession` is driven by an injected impl. */
class FakeSessionClient {
  acceptCalls = 0;
  createReceiverCalled = false;

  constructor(private readonly acceptImpl: (options: ServiceBusSessionReceiverOptions) => Promise<FakeSessionReceiver>) {}

  createReceiver(): never {
    this.createReceiverCalled = true;
    throw new Error('session-enabled config must use acceptNextSession, not createReceiver');
  }
  // Both the queue (name, options) and topic (name, subscription, options) overloads land here.
  acceptNextSession(...args: unknown[]): Promise<FakeSessionReceiver> {
    this.acceptCalls++;
    const options = args[args.length - 1] as ServiceBusSessionReceiverOptions;
    return this.acceptImpl(options);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** A promise that rejects only when the stop signal aborts — models `acceptNextSession` blocking for a session. */
function pendUntilAbort(options: ServiceBusSessionReceiverOptions): Promise<never> {
  const signal = options.abortSignal as AbortSignal | undefined;
  return new Promise<never>((_, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('aborted'));
      return;
    }
    signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
}

function factoryFor(client: FakeSessionClient): IServiceBusClientFactory {
  return { create: () => client as unknown as ServiceBusClient };
}

function createResolverFactory(): IServiceResolverFactory {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addServiceBusConsumer(container);
  return container.createServiceResolverFactory();
}

/** Builds a session worker over a real consumer pipeline (so settlement + the holder resolve). */
function sessionWorker(
  config: BenzeneServiceBusConfig,
  client: FakeSessionClient,
  configurePipeline: (ctx: ServiceBusConsumerContext, resolver: IServiceResolver) => void = () => {},
): BenzeneServiceBusWorker {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addServiceBusConsumer(container);
  const serviceResolverFactory = container.createServiceResolverFactory();

  const builder = new MiddlewarePipelineBuilder<ServiceBusConsumerContext>(container);
  builder.useFn(async (ctx, next, resolver) => {
    configurePipeline(ctx, resolver);
    await next();
  });
  const application = new ServiceBusConsumerApplication(builder.build());

  return new BenzeneServiceBusWorker(serviceResolverFactory, application, config, factoryFor(client));
}

describe('BenzeneServiceBusWorker session pump', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('consumes sessions via acceptNextSession, not createReceiver', async () => {
    const session = new FakeSessionReceiver('s1');
    let first = true;
    const client = new FakeSessionClient((options) => {
      if (first) {
        first = false;
        return Promise.resolve(session);
      }
      return pendUntilAbort(options);
    });
    const worker = sessionWorker(
      { queueName: 'q', sessionsEnabled: true, maxConcurrentSessions: 1 },
      client,
    );

    await worker.startAsync();
    await flushMicrotasks();

    expect(client.acceptCalls).toBeGreaterThanOrEqual(1);
    expect(client.createReceiverCalled).toBe(false);
    expect(session.processMessage).toBeDefined();

    await worker.stopAsync();
    expect(session.closed).toBe(true);
  });

  async function runOneSessionMessage(
    configurePipeline: (ctx: ServiceBusConsumerContext, resolver: IServiceResolver) => void,
    ackMode = ServiceBusConsumerAckMode.Explicit,
  ): Promise<FakeSessionReceiver> {
    const session = new FakeSessionReceiver('s1');
    let first = true;
    const client = new FakeSessionClient((options) => {
      if (first) {
        first = false;
        return Promise.resolve(session);
      }
      return pendUntilAbort(options);
    });
    const worker = sessionWorker(
      { queueName: 'q', sessionsEnabled: true, maxConcurrentSessions: 1, ackMode },
      client,
      configurePipeline,
    );

    await worker.startAsync();
    await flushMicrotasks();
    await session.processMessage!(message({ messageId: 'm1' }));
    await worker.stopAsync();
    return session;
  }

  it('completes a session message whose handler succeeds (same ack logic as the non-session path)', async () => {
    const session = await runOneSessionMessage((ctx) => {
      ctx.messageResult = BenzeneResult.ok();
    });
    expect(session.settled).toEqual([{ op: 'complete', messageId: 'm1' }]);
  });

  it('abandons a session message whose handler reports a failure result', async () => {
    const session = await runOneSessionMessage((ctx) => {
      ctx.messageResult = BenzeneResult.unexpectedError();
    });
    expect(session.settled).toEqual([{ op: 'abandon', messageId: 'm1' }]);
  });

  it('honours a handler-requested dead-letter override on a session message', async () => {
    const session = await runOneSessionMessage((ctx, resolver) => {
      ctx.messageResult = BenzeneResult.ok();
      const holder = resolver.getService(ServiceBusSettlementHolder);
      holder.override = ServiceBusSettlement.DeadLetter;
      holder.deadLetterReason = 'poison';
      holder.deadLetterDescription = 'cannot parse';
    });
    expect(session.settled).toEqual([
      {
        op: 'deadletter',
        messageId: 'm1',
        options: { deadLetterReason: 'poison', deadLetterErrorDescription: 'cannot parse' },
      },
    ]);
  });

  it('runs up to maxConcurrentSessions slots concurrently', async () => {
    const sessions = [
      new FakeSessionReceiver('s1'),
      new FakeSessionReceiver('s2'),
      new FakeSessionReceiver('s3'),
    ];
    let index = 0;
    const client = new FakeSessionClient((options) => {
      if (index < sessions.length) {
        return Promise.resolve(sessions[index++]);
      }
      return pendUntilAbort(options);
    });
    const worker = sessionWorker(
      { queueName: 'q', sessionsEnabled: true, maxConcurrentSessions: 3 },
      client,
    );

    await worker.startAsync();
    await flushMicrotasks();

    // Each of the 3 slots locked one session and parked on it — so exactly 3 accepts, no 4th.
    expect(client.acceptCalls).toBe(3);
    for (const session of sessions) {
      expect(session.processMessage).toBeDefined();
    }

    await worker.stopAsync();
    for (const session of sessions) {
      expect(session.closed).toBe(true);
    }
  });

  it('retries acceptNextSession when no session is available, without killing the pump', async () => {
    vi.useFakeTimers();
    const session = new FakeSessionReceiver('s1');
    let calls = 0;
    const client = new FakeSessionClient((options) => {
      calls++;
      if (calls === 1) {
        // The JS SDK rejects with a ServiceBusError when a session can't be locked — a normal retry case.
        return Promise.reject(Object.assign(new Error('no session'), { code: 'SessionCannotBeLocked' }));
      }
      if (calls === 2) {
        return Promise.resolve(session);
      }
      return pendUntilAbort(options);
    });
    const worker = sessionWorker(
      { queueName: 'q', sessionsEnabled: true, maxConcurrentSessions: 1 },
      client,
    );

    await worker.startAsync();
    await flushMicrotasks(); // let the first (rejected) accept reach the catch and schedule the backoff
    await vi.advanceTimersByTimeAsync(NO_SESSION_BACKOFF_MS); // fire the backoff → retry
    await flushMicrotasks();

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(session.processMessage).toBeDefined();

    await worker.stopAsync();
    expect(session.closed).toBe(true);
  });

  it('stopAsync ends the pump and closes an open session receiver', async () => {
    const session = new FakeSessionReceiver('s1');
    let first = true;
    const client = new FakeSessionClient((options) => {
      if (first) {
        first = false;
        return Promise.resolve(session);
      }
      return pendUntilAbort(options);
    });
    const worker = sessionWorker(
      { queueName: 'q', sessionsEnabled: true, maxConcurrentSessions: 1 },
      client,
    );

    await worker.startAsync();
    await flushMicrotasks();
    await worker.stopAsync();

    expect(session.closed).toBe(true);
  });
});
