import { describe, expect, it } from 'vitest';
import type { ServiceBusClient, ServiceBusReceivedMessage } from '@azure/service-bus';
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { Topic } from '@benzene/core-messages';
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
  ServiceBusConsumerMessageBodyGetter,
  ServiceBusConsumerMessageHeadersGetter,
  ServiceBusConsumerMessageTopicGetter,
  ServiceBusSettlement,
  ServiceBusSettlementHolder,
  withServiceBusConfigDefaults,
} from '@benzene/azure-service-bus';

/**
 * Port of the C# Benzene.Azure.ServiceBus tests (ServiceBusConsumerMapperTest,
 * ServiceBusConsumerApplicationTest, BenzeneServiceBusWorkerTest) plus end-to-end settlement tests that
 * stand in for the emulator integration test — driving the worker's `receiver.subscribe` push path over
 * a fake `ServiceBusClient`/receiver (the JS SDK settles on the receiver, not on event args).
 */

function message(
  fields: Partial<Pick<ServiceBusReceivedMessage, 'messageId' | 'body' | 'applicationProperties'>>,
): ServiceBusReceivedMessage {
  return fields as unknown as ServiceBusReceivedMessage;
}

function context(
  fields: Partial<Pick<ServiceBusReceivedMessage, 'messageId' | 'body' | 'applicationProperties'>>,
): ServiceBusConsumerContext {
  return ServiceBusConsumerContext.createInstance(message(fields));
}

/** A real container with the consumer services (so the transport pipeline + settlement holder resolve). */
function createResolverFactory(): IServiceResolverFactory {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addServiceBusConsumer(container);
  return container.createServiceResolverFactory();
}

describe('ServiceBusConsumer mappers', () => {
  it('reads the topic from the topic application property', () => {
    const topic = new ServiceBusConsumerMessageTopicGetter().getTopic(
      context({ applicationProperties: { topic: 'some-topic' } }),
    );
    expect(topic!.id).toBe('some-topic');
  });

  it('returns the missing topic id when the topic property is absent', () => {
    const topic = new ServiceBusConsumerMessageTopicGetter().getTopic(context({ applicationProperties: {} }));
    expect(topic!.id).toBe('<missing>');
  });

  it('reads a custom application-property key when configured', () => {
    const topic = new ServiceBusConsumerMessageTopicGetter('x-topic').getTopic(
      context({ applicationProperties: { 'x-topic': 'some-topic' } }),
    );
    expect(topic!.id).toBe('some-topic');
  });

  it('lets a preset topic override a missing topic property', () => {
    const holder = new PresetTopicHolder();
    holder.presetTopic = new Topic('preset-topic');
    const getter = new PresetTopicMessageTopicGetter<ServiceBusConsumerContext>(
      new ServiceBusConsumerMessageTopicGetter(),
      holder,
    );
    expect(getter.getTopic(context({ applicationProperties: {} }))!.id).toBe('preset-topic');
  });

  it('returns only string-typed application properties as headers', () => {
    const headers = new ServiceBusConsumerMessageHeadersGetter().getHeaders(
      context({ applicationProperties: { topic: 'some-topic', count: 5 } }),
    );
    expect(headers['topic']).toBe('some-topic');
    expect('count' in headers).toBe(false);
  });

  it('returns the body as a string', () => {
    expect(new ServiceBusConsumerMessageBodyGetter().getBody(context({ body: 'hello' }))).toBe('hello');
  });
});

describe('withServiceBusConfigDefaults', () => {
  it('applies the C# property-initializer defaults', () => {
    const config = withServiceBusConfigDefaults({ queueName: 'q' });
    expect(config.maxConcurrentCalls).toBe(5);
    expect(config.prefetchCount).toBe(0);
    expect(config.ackMode).toBe(ServiceBusConsumerAckMode.Explicit);
    expect(config.topicPropertyKey).toBe(ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty);
    expect(config.sessionsEnabled).toBe(false);
    expect(config.maxConcurrentSessions).toBe(8);
    expect(config.maxConcurrentCallsPerSession).toBe(1);
  });
});

describe('ServiceBusConsumerApplication', () => {
  it('maps the message to a context and returns the recorded result', async () => {
    const pipeline: IMiddlewarePipeline<ServiceBusConsumerContext> = {
      handleAsync: (ctx: ServiceBusConsumerContext) => {
        ctx.messageResult = BenzeneResult.unexpectedError();
        return Promise.resolve();
      },
    };
    const application = new ServiceBusConsumerApplication(pipeline);

    const decision = await application.handleAsync(message({ messageId: 'msg-1' }), createResolverFactory());

    expect(decision.messageResult).toBeDefined();
    expect(decision.messageResult!.isSuccessful).toBe(false);
  });

  it('returns an undefined result when nothing records one', async () => {
    const pipeline: IMiddlewarePipeline<ServiceBusConsumerContext> = {
      handleAsync: () => Promise.resolve(),
    };
    const application = new ServiceBusConsumerApplication(pipeline);

    const decision = await application.handleAsync(message({ messageId: 'msg-1' }), createResolverFactory());

    expect(decision.messageResult).toBeUndefined();
  });

  it('surfaces a handler-requested dead-letter override in the decision', async () => {
    const pipeline: IMiddlewarePipeline<ServiceBusConsumerContext> = {
      handleAsync: (_ctx: ServiceBusConsumerContext, resolver: IServiceResolver) => {
        const holder = resolver.getService(ServiceBusSettlementHolder);
        holder.override = ServiceBusSettlement.DeadLetter;
        holder.deadLetterReason = 'unprocessable';
        return Promise.resolve();
      },
    };
    const application = new ServiceBusConsumerApplication(pipeline);

    const decision = await application.handleAsync(message({ messageId: 'msg-1' }), createResolverFactory());

    expect(decision.settlement!.override).toBe(ServiceBusSettlement.DeadLetter);
    expect(decision.settlement!.deadLetterReason).toBe('unprocessable');
  });

  it('propagates a pipeline exception', async () => {
    const pipeline: IMiddlewarePipeline<ServiceBusConsumerContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    const application = new ServiceBusConsumerApplication(pipeline);

    await expect(
      application.handleAsync(message({ messageId: 'msg-1' }), createResolverFactory()),
    ).rejects.toThrow('boom');
  });
});

describe('BenzeneServiceBusWorker validation', () => {
  const noopFactory: IServiceBusClientFactory = {
    create: () => {
      throw new Error('client should not be created when validation fails');
    },
  };

  function worker(config: BenzeneServiceBusConfig): BenzeneServiceBusWorker {
    const pipeline: IMiddlewarePipeline<ServiceBusConsumerContext> = { handleAsync: () => Promise.resolve() };
    return new BenzeneServiceBusWorker(
      createResolverFactory(),
      new ServiceBusConsumerApplication(pipeline),
      config,
      noopFactory,
    );
  }

  it('throws without creating the client when no entity is configured', async () => {
    await expect(worker({}).startAsync()).rejects.toThrow(BenzeneException);
  });

  it('throws when both a queue and a subscription are configured', async () => {
    await expect(
      worker({ queueName: 'q', topicName: 't', subscriptionName: 's' }).startAsync(),
    ).rejects.toThrow(BenzeneException);
  });

  it('throws when a topic has no subscription', async () => {
    await expect(worker({ topicName: 't' }).startAsync()).rejects.toThrow(BenzeneException);
  });
});

/** A fake ServiceBusReceiver capturing the subscribe handlers and recording settle operations. */
class FakeReceiver {
  settled: { op: string; messageId: ServiceBusReceivedMessage['messageId']; options?: unknown }[] = [];
  processMessage!: (message: ServiceBusReceivedMessage) => Promise<void>;

  subscribe(handlers: { processMessage: (m: ServiceBusReceivedMessage) => Promise<void> }): { close(): Promise<void> } {
    this.processMessage = handlers.processMessage;
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

describe('BenzeneServiceBusWorker settlement (Explicit)', () => {
  async function runOneMessage(
    configurePipeline: (ctx: ServiceBusConsumerContext, resolver: IServiceResolver) => void,
    ackMode = ServiceBusConsumerAckMode.Explicit,
  ): Promise<FakeReceiver> {
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

    const receiver = new FakeReceiver();
    const factory: IServiceBusClientFactory = {
      create: () => new FakeClient(receiver) as unknown as ServiceBusClient,
    };
    const worker = new BenzeneServiceBusWorker(
      serviceResolverFactory,
      application,
      { queueName: 'q', ackMode },
      factory,
    );

    await worker.startAsync();
    await receiver.processMessage(message({ messageId: 'm1' }));
    await worker.stopAsync();
    return receiver;
  }

  it('completes a message whose handler succeeds', async () => {
    const receiver = await runOneMessage((ctx) => {
      ctx.messageResult = BenzeneResult.ok();
    });
    expect(receiver.settled).toEqual([{ op: 'complete', messageId: 'm1' }]);
  });

  it('abandons a message whose handler reports a failure result', async () => {
    const receiver = await runOneMessage((ctx) => {
      ctx.messageResult = BenzeneResult.unexpectedError();
    });
    expect(receiver.settled).toEqual([{ op: 'abandon', messageId: 'm1' }]);
  });

  it('abandons a message whose outcome was never set', async () => {
    const receiver = await runOneMessage(() => {
      /* nothing sets a result */
    });
    expect(receiver.settled).toEqual([{ op: 'abandon', messageId: 'm1' }]);
  });

  it('dead-letters a message when the handler requests it, passing the reason/description', async () => {
    const receiver = await runOneMessage((ctx, resolver) => {
      ctx.messageResult = BenzeneResult.ok();
      const holder = resolver.getService(ServiceBusSettlementHolder);
      holder.override = ServiceBusSettlement.DeadLetter;
      holder.deadLetterReason = 'poison';
      holder.deadLetterDescription = 'cannot parse';
    });
    expect(receiver.settled).toEqual([
      {
        op: 'deadletter',
        messageId: 'm1',
        options: { deadLetterReason: 'poison', deadLetterErrorDescription: 'cannot parse' },
      },
    ]);
  });

  it('defers a message when the handler requests it', async () => {
    const receiver = await runOneMessage((ctx, resolver) => {
      ctx.messageResult = BenzeneResult.ok();
      resolver.getService(ServiceBusSettlementHolder).override = ServiceBusSettlement.Defer;
    });
    expect(receiver.settled).toEqual([{ op: 'defer', messageId: 'm1' }]);
  });
});
