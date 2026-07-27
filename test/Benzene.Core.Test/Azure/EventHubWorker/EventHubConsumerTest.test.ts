import { describe, expect, it } from 'vitest';
import type {
  EventHubConsumerClient,
  PartitionContext,
  ReceivedEventData,
  SubscriptionEventHandlers,
} from '@azure/event-hubs';
import { IBenzeneInvocation } from '@benzene/abstractions-middleware';
import { IServiceResolver } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { Topic } from '@benzene/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';
import {
  addEventHubConsumer,
  BenzeneEventHubConfig,
  BenzeneEventHubWorker,
  EventHubConsumerApplication,
  EventHubConsumerContext,
  EventHubConsumerMessageBodyGetter,
  EventHubConsumerMessageHeadersGetter,
  EventHubConsumerMessageTopicGetter,
  IEventProcessorClientFactory,
  useBenzeneInvocation,
  withEventHubConfigDefaults,
} from '@benzene/azure-event-hub';

/**
 * Port of the C# Benzene.Azure.EventHub tests (EventHubConsumerMapperTest, EventHubConsumerApplicationTest,
 * EventHubBenzeneInvocationExtensionsTest, EventHubWorkerRaiseOnFailureTest). The worker's checkpoint
 * behaviour is driven by invoking the captured `processEvents` handler with a fake `PartitionContext`
 * whose `updateCheckpoint` records whether it was called (the JS equivalent of the C# reflection test's
 * `ProcessEventArgs` checkpoint callback).
 */

function event(
  fields: Partial<Pick<ReceivedEventData, 'sequenceNumber' | 'body' | 'properties'>>,
): ReceivedEventData {
  return { sequenceNumber: 1, ...fields } as unknown as ReceivedEventData;
}

function context(
  fields: Partial<Pick<ReceivedEventData, 'sequenceNumber' | 'body' | 'properties'>>,
): EventHubConsumerContext {
  return EventHubConsumerContext.createInstance(event(fields));
}

function createResolverFactory() {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addEventHubConsumer(container);
  return container.createServiceResolverFactory();
}

describe('EventHubConsumer mappers', () => {
  it('reads the topic from the topic property', () => {
    expect(
      new EventHubConsumerMessageTopicGetter().getTopic(context({ properties: { topic: 'some-topic' } }))!.id,
    ).toBe('some-topic');
  });

  it('returns the missing topic id when the topic property is absent', () => {
    expect(new EventHubConsumerMessageTopicGetter().getTopic(context({ properties: {} }))!.id).toBe('<missing>');
  });

  it('reads a custom property key when configured', () => {
    expect(
      new EventHubConsumerMessageTopicGetter('x-topic').getTopic(context({ properties: { 'x-topic': 't' } }))!.id,
    ).toBe('t');
  });

  it('lets a preset topic override a missing topic property', () => {
    const holder = new PresetTopicHolder();
    holder.presetTopic = new Topic('preset-topic');
    const getter = new PresetTopicMessageTopicGetter<EventHubConsumerContext>(
      new EventHubConsumerMessageTopicGetter(),
      holder,
    );
    expect(getter.getTopic(context({ properties: {} }))!.id).toBe('preset-topic');
  });

  it('returns only string-typed properties as headers', () => {
    const headers = new EventHubConsumerMessageHeadersGetter().getHeaders(
      context({ properties: { topic: 'some-topic', count: 5 } }),
    );
    expect(headers['topic']).toBe('some-topic');
    expect('count' in headers).toBe(false);
  });

  it('returns the body as a string', () => {
    expect(new EventHubConsumerMessageBodyGetter().getBody(context({ body: 'hello' }))).toBe('hello');
  });
});

describe('withEventHubConfigDefaults', () => {
  it('applies the C# property-initializer defaults', () => {
    const config = withEventHubConfigDefaults({});
    expect(config.checkpointInterval).toBe(1);
    expect(config.catchHandlerExceptions).toBe(true);
    expect(config.topicPropertyKey).toBe(EventHubConsumerMessageTopicGetter.DefaultTopicProperty);
    expect(config.raiseOnFailureStatus).toBe(true);
  });
});

describe('EventHubConsumerApplication', () => {
  it('maps the event to a context and returns the recorded result', async () => {
    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: (ctx) => {
        ctx.messageResult = BenzeneResult.unexpectedError();
        return Promise.resolve();
      },
    };
    const result = await new EventHubConsumerApplication(pipeline).handleAsync(
      event({ sequenceNumber: 7 }),
      createResolverFactory(),
    );
    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(false);
  });

  it('returns undefined when nothing records a result', async () => {
    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = { handleAsync: () => Promise.resolve() };
    const result = await new EventHubConsumerApplication(pipeline).handleAsync(
      event({ sequenceNumber: 7 }),
      createResolverFactory(),
    );
    expect(result).toBeUndefined();
  });

  it('propagates a pipeline exception', async () => {
    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    await expect(
      new EventHubConsumerApplication(pipeline).handleAsync(event({ sequenceNumber: 7 }), createResolverFactory()),
    ).rejects.toThrow('boom');
  });
});

describe('useBenzeneInvocation', () => {
  it('sets the invocation id to the event sequence number', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addBenzeneMessage(container);
    addEventHubConsumer(container);

    let capturedId: string | undefined;
    const builder = new MiddlewarePipelineBuilder<EventHubConsumerContext>(container);
    useBenzeneInvocation(builder);
    builder.useFn(async (_ctx, next, resolver) => {
      capturedId = resolver.getService(IBenzeneInvocation).invocationId;
      await next();
    });
    const pipeline = builder.build();

    const scope = container.createServiceResolverFactory().createScope();
    await pipeline.handleAsync(context({ sequenceNumber: 42 }), scope);
    scope.dispose();

    expect(capturedId).toBe('42');
  });
});

/** A fake EventHubConsumerClient capturing the subscribe handlers. */
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

function partitionContext(partitionId: string, onCheckpoint: (e: ReceivedEventData) => void): PartitionContext {
  return {
    partitionId,
    updateCheckpoint: (e: ReceivedEventData) => {
      onCheckpoint(e);
      return Promise.resolve();
    },
  } as unknown as PartitionContext;
}

describe('BenzeneEventHubWorker checkpoint / raise-on-failure', () => {
  async function processOneEvent(
    handlerSuccess: boolean | undefined,
    config: BenzeneEventHubConfig,
  ): Promise<{ checkpointed: boolean; client: FakeConsumerClient }> {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventHubConsumer(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: (ctx: EventHubConsumerContext, _r: IServiceResolver) => {
        if (handlerSuccess !== undefined) {
          ctx.messageResult = handlerSuccess ? BenzeneResult.ok() : BenzeneResult.unexpectedError();
        }
        return Promise.resolve();
      },
    };
    const application = new EventHubConsumerApplication(pipeline);
    const client = new FakeConsumerClient();
    const factory: IEventProcessorClientFactory = {
      create: () => client as unknown as EventHubConsumerClient,
    };
    const worker = new BenzeneEventHubWorker(serviceResolverFactory, application, config, factory);

    await worker.startAsync();
    let checkpointed = false;
    await client.handlers.processEvents(
      [event({ sequenceNumber: 1 })],
      partitionContext('0', () => {
        checkpointed = true;
      }),
    );
    return { checkpointed, client };
  }

  it('does not checkpoint a failure result when raiseOnFailureStatus is on', async () => {
    const { checkpointed } = await processOneEvent(false, {
      raiseOnFailureStatus: true,
      catchHandlerExceptions: true,
    });
    expect(checkpointed).toBe(false);
  });

  it('checkpoints a failure result when raiseOnFailureStatus is off', async () => {
    const { checkpointed } = await processOneEvent(false, { raiseOnFailureStatus: false });
    expect(checkpointed).toBe(true);
  });

  it('checkpoints a success result', async () => {
    const { checkpointed } = await processOneEvent(true, { raiseOnFailureStatus: true });
    expect(checkpointed).toBe(true);
  });

  it('checkpoints only every checkpointInterval events', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addEventHubConsumer(container);
    const serviceResolverFactory = container.createServiceResolverFactory();
    const pipeline: IMiddlewarePipeline<EventHubConsumerContext> = {
      handleAsync: (ctx) => {
        ctx.messageResult = BenzeneResult.ok();
        return Promise.resolve();
      },
    };
    const client = new FakeConsumerClient();
    const worker = new BenzeneEventHubWorker(
      serviceResolverFactory,
      new EventHubConsumerApplication(pipeline),
      { checkpointInterval: 3 },
      { create: () => client as unknown as EventHubConsumerClient },
    );
    await worker.startAsync();

    const checkpoints: number[] = [];
    const ctx = partitionContext('0', (e) => checkpoints.push(e.sequenceNumber));
    await client.handlers.processEvents(
      [event({ sequenceNumber: 1 }), event({ sequenceNumber: 2 }), event({ sequenceNumber: 3 })],
      ctx,
    );

    // Only the 3rd event (reaching the interval) checkpoints.
    expect(checkpoints).toEqual([3]);
  });
});
