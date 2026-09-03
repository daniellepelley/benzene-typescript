import { describe, expect, it } from 'vitest';
import type {
  EventHubConsumerClient,
  PartitionContext,
  ReceivedEventData,
  SubscriptionEventHandlers,
} from '@azure/event-hubs';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import {
  addEventHubConsumer,
  BenzeneEventHubWorker,
  EventHubConsumerApplication,
  EventHubConsumerContext,
} from '@benzenejs/azure-event-hub';

/**
 * Port of test/Benzene.Core.Test/Azure/EventHubWorker/EventHubWorkerCheckpointCancellationTest.cs's
 * shutdown-race pin (.NET R10 #116): checkpointing a successfully-handled event is part of graceful
 * drain and must not be gated on the stop signal. This worker is safe BY CONSTRUCTION in the JS
 * port — `PartitionContext.updateCheckpoint(event)` takes no `AbortSignal` (the .NET fix was to
 * checkpoint under `CancellationToken.None` instead of `args.CancellationToken`) — and these tests
 * pin that: a stop initiated while the event is in flight must not prevent the checkpoint.
 */

function event(sequenceNumber: number): ReceivedEventData {
  return { sequenceNumber } as unknown as ReceivedEventData;
}

class FakeConsumerClient {
  handlers!: SubscriptionEventHandlers;
  closed = false;
  subscribe(handlers: SubscriptionEventHandlers): { close(): Promise<void>; isRunning: boolean } {
    this.handlers = handlers;
    return {
      close: () => {
        this.closed = true;
        return Promise.resolve();
      },
      isRunning: true,
    };
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function partitionContext(onCheckpoint: (e: ReceivedEventData) => void): PartitionContext {
  return {
    partitionId: '0',
    updateCheckpoint: (e: ReceivedEventData) => {
      onCheckpoint(e);
      return Promise.resolve();
    },
  } as unknown as PartitionContext;
}

describe('BenzeneEventHubWorker shutdown race (checkpoint is cancellation-detached)', () => {
  it('#116: a stop initiated while the event is in flight still checks the event in', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventHubConsumer(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const client = new FakeConsumerClient();
    let worker!: BenzeneEventHubWorker;

    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: async (ctx) => {
        ctx.messageResult = BenzeneResult.ok();
        // The host stops the worker while this event's handler is still in flight — the .NET
        // shape where StopProcessingAsync fires args.CancellationToken mid-handler.
        await worker.stopAsync();
      },
    };
    worker = new BenzeneEventHubWorker(
      serviceResolverFactory,
      new EventHubConsumerApplication(pipeline),
      { checkpointInterval: 1 },
      { create: () => client as unknown as EventHubConsumerClient },
    );

    await worker.startAsync();

    const checkpoints: number[] = [];
    await client.handlers.processEvents(
      [event(1)],
      partitionContext((e) => checkpoints.push(e.sequenceNumber)),
    );

    // The subscription was closed by the stop, but the already-handled event was still checked in —
    // a restart resumes AFTER it instead of double-processing it.
    expect(client.closed).toBe(true);
    expect(checkpoints).toEqual([1]);
  });

  it('an already-fired start signal does not gate the checkpoint either', async () => {
    // startAsync's optional signal is a start-cancellation courtesy; the checkpoint path never
    // consults it (updateCheckpoint takes no signal at all) — pinned with a pre-aborted signal.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventHubConsumer(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const client = new FakeConsumerClient();
    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: (ctx) => {
        ctx.messageResult = BenzeneResult.ok();
        return Promise.resolve();
      },
    };
    const worker = new BenzeneEventHubWorker(
      serviceResolverFactory,
      new EventHubConsumerApplication(pipeline),
      { checkpointInterval: 1 },
      { create: () => client as unknown as EventHubConsumerClient },
    );

    const controller = new AbortController();
    controller.abort();
    await worker.startAsync(controller.signal);

    const checkpoints: number[] = [];
    await client.handlers.processEvents(
      [event(7)],
      partitionContext((e) => checkpoints.push(e.sequenceNumber)),
    );

    expect(checkpoints).toEqual([7]);
  });
});
