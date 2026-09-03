import { describe, expect, it } from 'vitest';
import type { ChannelModel, ConsumeMessage, Options } from 'amqplib';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import {
  addRabbitMqConsumer,
  IRabbitMqConnectionFactory,
  RabbitMqAckMode,
  RabbitMqApplication,
  RabbitMqConfig,
  RabbitMqContext,
  RabbitMqMessageBodyGetter,
  RabbitMqMessageHeadersGetter,
  RabbitMqMessageHandlerResultSetter,
  RabbitMqMessageTopicGetter,
  RabbitMqWorker,
  withRabbitMqConfigDefaults,
} from '@benzenejs/rabbitmq';

/**
 * Port of the C# Benzene.Core.Test.RabbitMq consumer tests (RabbitMqGettersTest, RabbitMqApplicationTest,
 * RabbitMqWorkerTest). The worker's ack/nack behaviour is driven by capturing the `onMessage` callback
 * passed to `channel.consume` on a fake amqplib channel/connection, then invoking it with a fake delivery
 * and recording whether `channel.ack`/`channel.nack` was called (and with what requeue) — the JS
 * equivalent of the C# broker-independent worker test that fires deliveries through the captured
 * `AsyncEventingBasicConsumer` against a mocked `IChannel`.
 */

function delivery(
  fields: Partial<{
    deliveryTag: number;
    redelivered: boolean;
    routingKey: string;
    headers: Record<string, unknown>;
    body: string;
  }> = {},
): ConsumeMessage {
  const { deliveryTag = 1, redelivered = false, routingKey = 'orderCreated', headers, body = '{}' } = fields;
  return {
    content: Buffer.from(body, 'utf8'),
    fields: { deliveryTag, redelivered, exchange: 'exchange', routingKey, consumerTag: 'consumer-tag' },
    properties: { headers } as ConsumeMessage['properties'],
  } as ConsumeMessage;
}

function context(fields: Parameters<typeof delivery>[0] = {}): RabbitMqContext {
  return RabbitMqContext.createInstance(delivery(fields));
}

// ---------------------------------------------------------------------------------------------------
// Mappers (RabbitMqGettersTest)
// ---------------------------------------------------------------------------------------------------

describe('RabbitMq consumer mappers', () => {
  it('prefers the topic header over the routing key', () => {
    const topic = new RabbitMqMessageTopicGetter().getTopic(
      context({ routingKey: 'some.routing.key', headers: { topic: Buffer.from('orderCreated', 'utf8') } }),
    );
    expect(topic!.id).toBe('orderCreated');
  });

  it('accepts a string topic header value', () => {
    const topic = new RabbitMqMessageTopicGetter().getTopic(context({ headers: { topic: 'orderShipped' } }));
    expect(topic!.id).toBe('orderShipped');
  });

  it('falls back to the routing key when there is no topic header', () => {
    const topic = new RabbitMqMessageTopicGetter().getTopic(context({ routingKey: 'orderPlaced', headers: undefined }));
    expect(topic!.id).toBe('orderPlaced');
  });

  it('reads a custom header key when configured', () => {
    const topic = new RabbitMqMessageTopicGetter('x-my-topic').getTopic(
      context({ routingKey: 'some.routing.key', headers: { 'x-my-topic': Buffer.from('orderCreated', 'utf8') } }),
    );
    expect(topic!.id).toBe('orderCreated');
  });

  it('ignores the default header and falls back to the routing key when a custom key is configured', () => {
    const topic = new RabbitMqMessageTopicGetter('x-my-topic').getTopic(
      context({ routingKey: 'orderPlaced', headers: { topic: Buffer.from('orderCreated', 'utf8') } }),
    );
    expect(topic!.id).toBe('orderPlaced');
  });

  it('utf-8 decodes the body', () => {
    expect(new RabbitMqMessageBodyGetter().getBody(context({ body: '{"name":"benzene"}' }))).toBe(
      '{"name":"benzene"}',
    );
  });

  it('decodes byte-array and string header values', () => {
    const headers = new RabbitMqMessageHeadersGetter().getHeaders(
      context({ headers: { 'correlation-id': Buffer.from('abc-123', 'utf8'), tenant: 'acme' } }),
    );
    expect(headers['correlation-id']).toBe('abc-123');
    expect(headers['tenant']).toBe('acme');
  });

  it('returns an empty header map when there are no headers', () => {
    expect(new RabbitMqMessageHeadersGetter().getHeaders(context({ headers: undefined }))).toEqual({});
  });

  it('records handler success on the message result', async () => {
    const ctx = context();
    await new RabbitMqMessageHandlerResultSetter().setResultAsync(ctx, {
      benzeneResult: BenzeneResult.ok(),
    } as never);
    expect(ctx.messageResult.isSuccessful).toBe(true);
  });

  it('records handler failure on the message result', async () => {
    const ctx = context();
    await new RabbitMqMessageHandlerResultSetter().setResultAsync(ctx, {
      benzeneResult: BenzeneResult.unexpectedError(),
    } as never);
    expect(ctx.messageResult.isSuccessful).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------
// withRabbitMqConfigDefaults
// ---------------------------------------------------------------------------------------------------

describe('withRabbitMqConfigDefaults', () => {
  it('applies the C# property-initializer defaults', () => {
    const config = withRabbitMqConfigDefaults({ queueName: 'q' });
    expect(config.ackMode).toBe(RabbitMqAckMode.Explicit);
    expect(config.prefetchCount).toBe(5);
    expect(config.concurrentRequests).toBe(5);
    expect(config.requeueOnFailure).toBe(true);
    expect(config.drainTimeoutMs).toBe(30000);
    expect(config.topicHeaderKey).toBe('topic');
  });
});

// ---------------------------------------------------------------------------------------------------
// RabbitMqApplication (RabbitMqApplicationTest)
// ---------------------------------------------------------------------------------------------------

function createResolverFactory() {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addRabbitMqConsumer(container);
  return container.createServiceResolverFactory();
}

describe('RabbitMqApplication', () => {
  it('maps the delivery to a context and returns the recorded result', async () => {
    const pipeline: IMiddlewarePipeline<RabbitMqContext> = {
      handleAsync: (ctx) => {
        expect(ctx.message.fields.routingKey).toBe('orderCreated');
        ctx.messageResult = BenzeneResult.unexpectedError();
        return Promise.resolve();
      },
    };
    const result = await new RabbitMqApplication(pipeline).handleAsync(delivery(), createResolverFactory());
    expect(result).toBeDefined();
    expect(result!.isSuccessful).toBe(false);
  });

  it('returns undefined when nothing records a result', async () => {
    const pipeline: IMiddlewarePipeline<RabbitMqContext> = { handleAsync: () => Promise.resolve() };
    const result = await new RabbitMqApplication(pipeline).handleAsync(delivery(), createResolverFactory());
    expect(result).toBeUndefined();
  });

  it('propagates a pipeline exception', async () => {
    const pipeline: IMiddlewarePipeline<RabbitMqContext> = {
      handleAsync: () => Promise.reject(new Error('boom')),
    };
    await expect(
      new RabbitMqApplication(pipeline).handleAsync(delivery(), createResolverFactory()),
    ).rejects.toThrow('boom');
  });
});

// ---------------------------------------------------------------------------------------------------
// RabbitMqWorker (RabbitMqWorkerTest)
// ---------------------------------------------------------------------------------------------------

/** A fake amqplib channel capturing the consume callback and recording ack/nack/lifecycle calls. */
class FakeChannel {
  onMessage: ((msg: ConsumeMessage | null) => void) | undefined;
  consumeQueue: string | undefined;
  consumeOptions: Options.Consume | undefined;
  prefetchCount: number | undefined;
  readonly acked: number[] = [];
  readonly nacked: Array<{ tag: number; requeue: boolean }> = [];
  cancelled = false;
  closed = false;

  prefetch(count: number): Promise<unknown> {
    this.prefetchCount = count;
    return Promise.resolve({});
  }
  consume(
    queue: string,
    onMessage: (msg: ConsumeMessage | null) => void,
    options?: Options.Consume,
  ): Promise<{ consumerTag: string }> {
    this.consumeQueue = queue;
    this.onMessage = onMessage;
    this.consumeOptions = options;
    return Promise.resolve({ consumerTag: 'consumer-tag' });
  }
  ack(message: ConsumeMessage): void {
    this.acked.push(message.fields.deliveryTag);
  }
  nack(message: ConsumeMessage, _allUpTo: boolean, requeue: boolean): void {
    this.nacked.push({ tag: message.fields.deliveryTag, requeue });
  }
  cancel(): Promise<unknown> {
    this.cancelled = true;
    return Promise.resolve({});
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

/** A fake amqplib ChannelModel (connection) returning the fake channel. */
class FakeConnection {
  closed = false;
  constructor(private readonly channel: FakeChannel) {}
  createChannel(): Promise<FakeChannel> {
    return Promise.resolve(this.channel);
  }
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function workerFor(
  config: RabbitMqConfig,
  pipeline: IMiddlewarePipeline<RabbitMqContext>,
): { worker: RabbitMqWorker; channel: FakeChannel; connection: FakeConnection } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addRabbitMqConsumer(container);
  const serviceResolverFactory = container.createServiceResolverFactory();
  const channel = new FakeChannel();
  const connection = new FakeConnection(channel);
  const connectionFactory: IRabbitMqConnectionFactory = {
    createConnectionAsync: () => Promise.resolve(connection as unknown as ChannelModel),
  };
  const worker = new RabbitMqWorker(
    serviceResolverFactory,
    new RabbitMqApplication(pipeline),
    config,
    connectionFactory,
  );
  return { worker, channel, connection };
}

function resultPipeline(result: boolean | undefined): IMiddlewarePipeline<RabbitMqContext> {
  return {
    handleAsync: (ctx) => {
      if (result !== undefined) {
        ctx.messageResult = result ? BenzeneResult.ok() : BenzeneResult.unexpectedError();
      }
      return Promise.resolve();
    },
  };
}

const throwingPipeline: IMiddlewarePipeline<RabbitMqContext> = {
  handleAsync: () => Promise.reject(new Error('boom')),
};

const baseConfig = (overrides: Partial<RabbitMqConfig> = {}): RabbitMqConfig => ({
  queueName: 'queue',
  concurrentRequests: 1,
  requeueOnFailure: true,
  ...overrides,
});

/** Awaits until `predicate` holds (the dispatched handler runs on a background lane), or fails. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}

describe('RabbitMqWorker', () => {
  it('opens the connection/channel, sets prefetch, and consumes the configured queue', async () => {
    const { worker, channel } = workerFor(baseConfig({ prefetchCount: 9 }), resultPipeline(true));
    await worker.startAsync();

    expect(channel.consumeQueue).toBe('queue');
    expect(channel.prefetchCount).toBe(9);
    expect(channel.consumeOptions?.noAck).toBe(false);
  });

  it('acks a successful handler', async () => {
    const { worker, channel } = workerFor(baseConfig(), resultPipeline(true));
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 7, redelivered: false }));

    await waitFor(() => channel.acked.length > 0);
    expect(channel.acked).toEqual([7]);
    expect(channel.nacked).toHaveLength(0);
  });

  it('nacks with requeue on a first-delivery failure result', async () => {
    const { worker, channel } = workerFor(baseConfig(), resultPipeline(false));
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 8, redelivered: false }));

    await waitFor(() => channel.nacked.length > 0);
    expect(channel.nacked).toEqual([{ tag: 8, requeue: true }]);
    expect(channel.acked).toHaveLength(0);
  });

  it('nacks without requeue on a redelivered failure (bounding the poison loop)', async () => {
    const { worker, channel } = workerFor(baseConfig(), resultPipeline(false));
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 9, redelivered: true }));

    await waitFor(() => channel.nacked.length > 0);
    expect(channel.nacked).toEqual([{ tag: 9, requeue: false }]);
  });

  it('nacks without requeue when requeueOnFailure is disabled', async () => {
    const { worker, channel } = workerFor(baseConfig({ requeueOnFailure: false }), resultPipeline(false));
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 10, redelivered: false }));

    await waitFor(() => channel.nacked.length > 0);
    expect(channel.nacked).toEqual([{ tag: 10, requeue: false }]);
  });

  it('nacks when the handler throws', async () => {
    const { worker, channel } = workerFor(baseConfig(), throwingPipeline);
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 11, redelivered: false }));

    await waitFor(() => channel.nacked.length > 0);
    expect(channel.nacked).toEqual([{ tag: 11, requeue: true }]);
  });

  it('nacks when no result is recorded (null outcome is retained, not silently completed)', async () => {
    // Nothing set a messageResult (result: undefined, no throw) — typically an unrouted delivery
    // whose topic matched no handler. Per benzene-dotnet's work/settlement-consistency-fix-plan.md
    // (row 7 and its decision register) a null outcome settles like a failure: nack, with the
    // bounded single requeue + DLX as the backstop. This deliberately inverts the previous
    // ack-on-null behaviour this test used to assert.
    const { worker, channel } = workerFor(baseConfig(), resultPipeline(undefined));
    await worker.startAsync();

    channel.onMessage!(delivery({ deliveryTag: 12, redelivered: false }));

    await waitFor(() => channel.nacked.length > 0);
    expect(channel.nacked).toEqual([{ tag: 12, requeue: true }]);
    expect(channel.acked).toHaveLength(0);
  });

  it('consumes with noAck true under AutoAck mode and does not settle manually', async () => {
    const { worker, channel } = workerFor(
      baseConfig({ ackMode: RabbitMqAckMode.AutoAck }),
      resultPipeline(true),
    );
    await worker.startAsync();

    expect(channel.consumeOptions?.noAck).toBe(true);

    channel.onMessage!(delivery({ deliveryTag: 13, redelivered: false }));
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    expect(channel.acked).toHaveLength(0);
    expect(channel.nacked).toHaveLength(0);
  });

  it('ignores a null delivery (server-side consumer cancellation)', async () => {
    const { worker, channel } = workerFor(baseConfig(), resultPipeline(true));
    await worker.startAsync();

    channel.onMessage!(null);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    expect(channel.acked).toHaveLength(0);
    expect(channel.nacked).toHaveLength(0);
  });

  it('cancels the consumer and closes the channel and connection on stopAsync', async () => {
    const { worker, channel, connection } = workerFor(baseConfig(), resultPipeline(true));
    await worker.startAsync();
    await worker.stopAsync();

    expect(channel.cancelled).toBe(true);
    expect(channel.closed).toBe(true);
    expect(connection.closed).toBe(true);
  });

  it('tears down the channel and connection (and drains the dispatcher) when startAsync fails', async () => {
    // The dispatcher's lane tasks start before the fallible connection/consume steps; a failure mid-start
    // must tear everything back down (stopAsync) and rethrow, rather than leaking lanes and an open channel.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addRabbitMqConsumer(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const channel = new FakeChannel();
    channel.consume = () => Promise.reject(new Error('consume failed'));
    const connection = new FakeConnection(channel);
    const connectionFactory: IRabbitMqConnectionFactory = {
      createConnectionAsync: () => Promise.resolve(connection as unknown as ChannelModel),
    };
    const worker = new RabbitMqWorker(
      serviceResolverFactory,
      new RabbitMqApplication(resultPipeline(true)),
      baseConfig(),
      connectionFactory,
    );

    await expect(worker.startAsync()).rejects.toThrow('consume failed');
    // Teardown ran despite the failed start: the channel and connection were closed.
    expect(channel.closed).toBe(true);
    expect(connection.closed).toBe(true);
  });
});
