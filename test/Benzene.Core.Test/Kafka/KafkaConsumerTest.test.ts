import { describe, expect, it } from 'vitest';
import type { Consumer, ConsumerRunConfig, EachMessagePayload } from 'kafkajs';
import { IBenzeneInvocation, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { IServiceResolver } from '@benzene/abstractions';
import {
  addBenzene,
  addBenzeneMessage,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';
import {
  addKafkaConsumer,
  BenzeneKafkaConfig,
  BenzeneKafkaWorker,
  IKafkaConsumerFactory,
  KafkaApplication,
  KafkaMessageBodyGetter,
  KafkaMessageHeadersGetter,
  KafkaMessageHandlerResultSetter,
  KafkaMessageTopicGetter,
  KafkaRecordContext,
  useBenzeneInvocation,
  withKafkaConfigDefaults,
} from '@benzene/kafka-core';

/**
 * Port of the C# Benzene.Kafka.Core consumer tests (KafkaCoreMappersTest, BenzeneKafkaConfigTest,
 * BenzeneKafkaWorkerTest, KafkaCoreBenzeneInvocationExtensionsTest). The worker's commit behaviour is
 * driven by capturing the `eachMessage` handler passed to `consumer.run` on a fake kafkajs consumer,
 * then invoking it with a fake record and recording whether `commitOffsets`/`disconnect` were called —
 * the JS equivalent of the C# broker-independent worker test.
 */

function payload(
  fields: Partial<{
    topic: string;
    partition: number;
    value: Buffer | string | null;
    offset: string;
    headers: Record<string, Buffer | string | (Buffer | string)[] | undefined>;
  }>,
): EachMessagePayload {
  const { topic = 'my-topic', partition = 0, value = null, offset = '1', headers } = fields;
  return {
    topic,
    partition,
    message: { value, offset, headers, key: null },
  } as unknown as EachMessagePayload;
}

function context(
  fields: Parameters<typeof payload>[0],
): KafkaRecordContext {
  return KafkaRecordContext.createInstance(payload(fields));
}

function createResolverFactory() {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addKafkaConsumer(container);
  return container.createServiceResolverFactory();
}

describe('Kafka consumer mappers', () => {
  it('reads the topic from the record', () => {
    expect(new KafkaMessageTopicGetter().getTopic(context({ topic: 'my-topic' }))!.id).toBe('my-topic');
  });

  it('returns the record value as a string', () => {
    expect(new KafkaMessageBodyGetter().getBody(context({ value: 'hello' }))).toBe('hello');
  });

  it('utf-8 decodes a Buffer value rather than stringifying it', () => {
    expect(new KafkaMessageBodyGetter().getBody(context({ value: Buffer.from('hello-bytes', 'utf8') }))).toBe(
      'hello-bytes',
    );
  });

  it('returns undefined when the value is null', () => {
    expect(new KafkaMessageBodyGetter().getBody(context({ value: null }))).toBeUndefined();
  });

  it('utf-8 decodes header values', () => {
    const headers = new KafkaMessageHeadersGetter().getHeaders(
      context({ headers: { traceparent: Buffer.from('abc-123', 'utf8') } }),
    );
    expect(headers['traceparent']).toBe('abc-123');
  });

  it('takes the last value for a duplicate header key', () => {
    const headers = new KafkaMessageHeadersGetter().getHeaders(
      context({ headers: { trace: [Buffer.from('a', 'utf8'), Buffer.from('b', 'utf8')] } }),
    );
    expect(headers['trace']).toBe('b');
  });

  it('records handler success on the message result', async () => {
    const ctx = context({ value: 'hello' });
    await new KafkaMessageHandlerResultSetter().setResultAsync(ctx, {
      benzeneResult: BenzeneResult.ok(),
    } as never);
    expect(ctx.messageResult.isSuccessful).toBe(true);
  });

  it('records handler failure on the message result', async () => {
    const ctx = context({ value: 'hello' });
    await new KafkaMessageHandlerResultSetter().setResultAsync(ctx, {
      benzeneResult: BenzeneResult.serviceUnavailable(),
    } as never);
    expect(ctx.messageResult.isSuccessful).toBe(false);
  });
});

describe('withKafkaConfigDefaults', () => {
  it('applies the C# property-initializer defaults', () => {
    const config = withKafkaConfigDefaults({ topics: ['t'] });
    expect(config.concurrentRequests).toBe(5);
    expect(config.preserveOrderPerPartition).toBe(true);
    expect(config.catchHandlerExceptions).toBe(true);
    expect(config.commitOnlyOnSuccess).toBe(false);
  });
});

describe('KafkaApplication', () => {
  it('maps the record to a context and returns the recorded result', async () => {
    const pipeline: IMiddlewarePipeline<KafkaRecordContext> = {
      handleAsync: (ctx) => {
        ctx.messageResult = BenzeneResult.unexpectedError();
        return Promise.resolve();
      },
    };
    const result = await new KafkaApplication(pipeline).handleAsync(
      payload({ value: 'hello' }),
      createResolverFactory(),
    );
    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(false);
  });

  it('returns undefined when nothing records a result', async () => {
    const pipeline: IMiddlewarePipeline<KafkaRecordContext> = { handleAsync: () => Promise.resolve() };
    const result = await new KafkaApplication(pipeline).handleAsync(
      payload({ value: 'hello' }),
      createResolverFactory(),
    );
    expect(result).toBeUndefined();
  });

  it('propagates a pipeline exception', async () => {
    const pipeline: IMiddlewarePipeline<KafkaRecordContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    await expect(
      new KafkaApplication(pipeline).handleAsync(payload({ value: 'hello' }), createResolverFactory()),
    ).rejects.toThrow('boom');
  });
});

describe('useBenzeneInvocation', () => {
  it('sets the invocation id to {topic}-{partition}-{offset}', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addBenzeneMessage(container);
    addKafkaConsumer(container);

    let capturedId: string | undefined;
    let capturedPlatform: string | undefined;
    const builder = new MiddlewarePipelineBuilder<KafkaRecordContext>(container);
    useBenzeneInvocation(builder);
    builder.useFn(async (_ctx, next, resolver) => {
      const invocation = resolver.getService(IBenzeneInvocation);
      capturedId = invocation.invocationId;
      capturedPlatform = invocation.platform;
      await next();
    });
    const pipeline = builder.build();

    const scope = container.createServiceResolverFactory().createScope();
    await pipeline.handleAsync(context({ topic: 'orders', partition: 3, offset: '99' }), scope);
    scope.dispose();

    expect(capturedId).toBe('orders-3-99');
    expect(capturedPlatform).toBe('Worker');
  });
});

/** A fake kafkajs consumer capturing the `run` config and recording lifecycle calls. */
class FakeConsumer {
  runConfig: ConsumerRunConfig | undefined;
  subscribeArgs: { topics: string[]; fromBeginning?: boolean } | undefined;
  committed: Array<{ topic: string; partition: number; offset: string }> = [];
  connected = false;
  disconnected = false;

  connect(): Promise<void> {
    this.connected = true;
    return Promise.resolve();
  }
  subscribe(args: { topics: string[]; fromBeginning?: boolean }): Promise<void> {
    this.subscribeArgs = args;
    return Promise.resolve();
  }
  run(config: ConsumerRunConfig): Promise<void> {
    this.runConfig = config;
    return Promise.resolve();
  }
  commitOffsets(topicPartitions: Array<{ topic: string; partition: number; offset: string }>): Promise<void> {
    this.committed.push(...topicPartitions);
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.disconnected = true;
    return Promise.resolve();
  }
}

function workerFor(
  config: BenzeneKafkaConfig,
  pipeline: IMiddlewarePipeline<KafkaRecordContext>,
): { worker: BenzeneKafkaWorker; consumer: FakeConsumer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addKafkaConsumer(container);
  const serviceResolverFactory = container.createServiceResolverFactory();
  const consumer = new FakeConsumer();
  const factory: IKafkaConsumerFactory = { create: () => consumer as unknown as Consumer };
  const worker = new BenzeneKafkaWorker(
    serviceResolverFactory,
    new KafkaApplication(pipeline),
    config,
    factory,
  );
  return { worker, consumer };
}

const okPipeline: IMiddlewarePipeline<KafkaRecordContext> = {
  handleAsync: (ctx) => {
    ctx.messageResult = BenzeneResult.ok();
    return Promise.resolve();
  },
};

describe('BenzeneKafkaWorker startup validation', () => {
  it('throws when commitOnlyOnSuccess is combined with catchHandlerExceptions', async () => {
    const { worker } = workerFor(
      { topics: ['t'], commitOnlyOnSuccess: true, catchHandlerExceptions: true, preserveOrderPerPartition: true },
      okPipeline,
    );
    await expect(worker.startAsync()).rejects.toThrow(/catchHandlerExceptions/);
  });

  it('throws when commitOnlyOnSuccess is combined with preserveOrderPerPartition = false', async () => {
    const { worker } = workerFor(
      { topics: ['t'], commitOnlyOnSuccess: true, catchHandlerExceptions: false, preserveOrderPerPartition: false },
      okPipeline,
    );
    await expect(worker.startAsync()).rejects.toThrow(/preserveOrderPerPartition/);
  });
});

describe('BenzeneKafkaWorker consume behaviour', () => {
  it('subscribes to the configured topics and runs with autoCommit on by default', async () => {
    const { worker, consumer } = workerFor({ topics: ['a', 'b'], concurrentRequests: 7 }, okPipeline);
    await worker.startAsync();

    expect(consumer.connected).toBe(true);
    expect(consumer.subscribeArgs?.topics).toEqual(['a', 'b']);
    expect(consumer.runConfig?.autoCommit).toBe(true);
    expect(consumer.runConfig?.partitionsConsumedConcurrently).toBe(7);
  });

  it('does not commit by hand under the default auto-commit config', async () => {
    const { worker, consumer } = workerFor({ topics: ['t'] }, okPipeline);
    await worker.startAsync();
    await consumer.runConfig!.eachMessage!(payload({ topic: 't', partition: 0, offset: '5', value: 'hi' }));
    expect(consumer.committed).toHaveLength(0);
  });

  it('commits offset + 1 after a successful handle under commitOnlyOnSuccess', async () => {
    const { worker, consumer } = workerFor(
      { topics: ['t'], commitOnlyOnSuccess: true, catchHandlerExceptions: false },
      okPipeline,
    );
    await worker.startAsync();

    expect(consumer.runConfig?.autoCommit).toBe(false);
    await consumer.runConfig!.eachMessage!(payload({ topic: 't', partition: 2, offset: '41', value: 'hi' }));

    expect(consumer.committed).toEqual([{ topic: 't', partition: 2, offset: '42' }]);
  });

  it('does not commit a failed record under commitOnlyOnSuccess', async () => {
    const failingPipeline: IMiddlewarePipeline<KafkaRecordContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    const { worker, consumer } = workerFor(
      { topics: ['t'], commitOnlyOnSuccess: true, catchHandlerExceptions: false },
      failingPipeline,
    );
    await worker.startAsync();
    await consumer.runConfig!.eachMessage!(payload({ topic: 't', partition: 0, offset: '5', value: 'hi' }));

    expect(consumer.committed).toHaveLength(0);
  });

  it('keeps consuming after a handler exception when catchHandlerExceptions is on', async () => {
    const failingPipeline: IMiddlewarePipeline<KafkaRecordContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    const { worker, consumer } = workerFor(
      { topics: ['t'], catchHandlerExceptions: true },
      failingPipeline,
    );
    await worker.startAsync();
    // Does not throw out of eachMessage (so kafkajs advances rather than retrying) and does not stop.
    await expect(
      consumer.runConfig!.eachMessage!(payload({ topic: 't', partition: 0, offset: '5', value: 'hi' })),
    ).resolves.toBeUndefined();
    await Promise.resolve();
    expect(consumer.disconnected).toBe(false);
  });

  it('stops the worker on a handler exception when catchHandlerExceptions is off', async () => {
    const failingPipeline: IMiddlewarePipeline<KafkaRecordContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    const { worker, consumer } = workerFor(
      { topics: ['t'], catchHandlerExceptions: false },
      failingPipeline,
    );
    await worker.startAsync();
    await consumer.runConfig!.eachMessage!(payload({ topic: 't', partition: 0, offset: '5', value: 'hi' }));
    // The stop is deferred via queueMicrotask; let it run.
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(consumer.disconnected).toBe(true);
  });

  it('disconnects the consumer on stopAsync', async () => {
    const { worker, consumer } = workerFor({ topics: ['t'] }, okPipeline);
    await worker.startAsync();
    await worker.stopAsync();
    expect(consumer.disconnected).toBe(true);
  });
});
