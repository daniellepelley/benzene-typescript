import { describe, expect, it } from 'vitest';
import type { ServiceBusClient, ServiceBusReceivedMessage } from '@azure/service-bus';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import {
  addServiceBusConsumer,
  BenzeneServiceBusWorker,
  IServiceBusClientFactory,
  ServiceBusConsumerApplication,
  ServiceBusConsumerContext,
} from '@benzenejs/azure-service-bus';

/**
 * Port of test/Benzene.Core.Test/Azure/ServiceBusWorker/BenzeneServiceBusWorkerSettlementCancellationTest.cs's
 * shutdown-race pins (.NET R10 #117): settling an already-handled message is part of graceful drain
 * and must not be gated on the stop signal. This worker is safe BY CONSTRUCTION in the JS port — the
 * settle calls (`receiver.completeMessage`/`abandonMessage`/...) never carry an `AbortSignal` at all
 * (the .NET fix was to pass `CancellationToken.None` instead of `args.CancellationToken`) — and
 * these tests pin that: a stop signal that fires between the handler completing and settlement must
 * still complete/abandon the message.
 */

function message(messageId: string): ServiceBusReceivedMessage {
  return { messageId } as unknown as ServiceBusReceivedMessage;
}

/** A fake receiver recording settles; the settle methods deliberately accept no abort signal. */
class FakeReceiver {
  settled: { op: string; messageId: ServiceBusReceivedMessage['messageId'] }[] = [];
  processMessage!: (m: ServiceBusReceivedMessage) => Promise<void>;
  subscribeSignals: (AbortSignal | undefined)[] = [];

  subscribe(
    handlers: { processMessage: (m: ServiceBusReceivedMessage) => Promise<void> },
    options?: { abortSignal?: AbortSignal },
  ): { close(): Promise<void> } {
    this.processMessage = handlers.processMessage;
    this.subscribeSignals.push(options?.abortSignal);
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
  deadLetterMessage(m: ServiceBusReceivedMessage): Promise<void> {
    this.settled.push({ op: 'deadletter', messageId: m.messageId });
    return Promise.resolve();
  }
  deferMessage(m: ServiceBusReceivedMessage): Promise<void> {
    this.settled.push({ op: 'defer', messageId: m.messageId });
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeClient {
  constructor(readonly receiver: FakeReceiver) {}
  createReceiver(): FakeReceiver {
    return this.receiver;
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

async function runOneMessageWithShutdownRace(
  outcome: 'ok' | 'fail',
): Promise<{ receiver: FakeReceiver; controller: AbortController }> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addServiceBusConsumer(container);
  const serviceResolverFactory = container.createServiceResolverFactory();

  const controller = new AbortController();
  const builder = new MiddlewarePipelineBuilder<ServiceBusConsumerContext>(container);
  builder.useFn(async (ctx, next) => {
    ctx.messageResult = outcome === 'ok' ? BenzeneResult.ok() : BenzeneResult.unexpectedError();
    // The host's stop signal fires while this message is in flight — after the handler's outcome is
    // decided but before the worker settles it.
    controller.abort();
    await next();
  });
  const application = new ServiceBusConsumerApplication(builder.build());

  const receiver = new FakeReceiver();
  const factory: IServiceBusClientFactory = {
    create: () => new FakeClient(receiver) as unknown as ServiceBusClient,
  };
  const worker = new BenzeneServiceBusWorker(
    serviceResolverFactory,
    application,
    { queueName: 'q' },
    factory,
  );

  await worker.startAsync(controller.signal);
  await receiver.processMessage(message('m1'));
  await worker.stopAsync();
  return { receiver, controller };
}

describe('BenzeneServiceBusWorker shutdown race (settlement is cancellation-detached)', () => {
  it('#117: a stop signal firing after the handler succeeds still completes the message', async () => {
    const { receiver, controller } = await runOneMessageWithShutdownRace('ok');

    expect(controller.signal.aborted).toBe(true);
    expect(receiver.settled).toEqual([{ op: 'complete', messageId: 'm1' }]);
    // The stop signal only ever reaches subscribe (to stop RECEIVING new messages) — the settle
    // methods on the receiver take no signal at all, which is what makes settlement detached.
    expect(receiver.subscribeSignals).toEqual([controller.signal]);
  });

  it('#117: a stop signal firing after the handler fails still abandons the message for redelivery', async () => {
    const { receiver } = await runOneMessageWithShutdownRace('fail');

    expect(receiver.settled).toEqual([{ op: 'abandon', messageId: 'm1' }]);
  });
});
