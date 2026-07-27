import { describe, expect, it } from 'vitest';
import type {
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  Message,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { IServiceResolver, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import {
  addBenzene,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { Topic } from '@benzene/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult } from '@benzene/results';
import {
  ISqsClientFactory,
  ISqsConsumerClient,
  SqsConsumer,
  SqsConsumerAckMode,
  SqsConsumerApplication,
  SqsConsumerConfig,
  SqsConsumerMessageContext,
  SqsConsumerMessageHeadersGetter,
  SqsConsumerMessageTopicGetter,
  SqsConsumerOptions,
  withConfigDefaults,
  useSqs,
} from '@benzene/aws-sqs';
import { BenzeneWorkerBuilder, IBenzeneWorkerStartup } from '@benzene/self-host';

/**
 * Port of the C# Benzene.Aws.Sqs consumer tests (SqsConsumerAckModeTest, SqsConsumerMessageTopicGetterTest,
 * SqsConsumerMessageHeadersGetterTest, SqsConsumerPolishTest, UseSqsTest, and a unit-level SqsConsumerTest
 * standing in for the LocalStack integration test). The AWS-SDK `Message` uses PascalCase fields.
 */

/** Builds a real container/resolver factory so the transport pipeline can resolve `ISetCurrentTransport`. */
function createResolverFactory(): IServiceResolverFactory {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  return container.createServiceResolverFactory();
}

/** A pipeline whose handler sets each message's result from a predicate on the message id. */
function resultByIdPipeline(
  isSuccessful: (messageId: string) => boolean,
  yieldFirst = false,
): IMiddlewarePipeline<SqsConsumerMessageContext> {
  return {
    async handleAsync(context: SqsConsumerMessageContext, _resolver: IServiceResolver): Promise<void> {
      if (yieldFirst) {
        await Promise.resolve();
      }
      context.messageResult = isSuccessful(context.message.MessageId ?? '')
        ? BenzeneResult.ok()
        : BenzeneResult.unexpectedError();
    },
  };
}

function message(id: string): Message {
  return { MessageId: id, ReceiptHandle: `r-${id}` };
}

describe('SqsConsumerApplication (ack mode)', () => {
  it('reports exactly the failed messages when many fail concurrently', async () => {
    // A yielding pipeline forces the per-message tasks to resume interleaved — the exact condition a
    // shared, non-thread-safe append would corrupt. Each returns its own failed message instead.
    const pipeline = resultByIdPipeline((id) => !id.startsWith('fail'), true);
    const application = new SqsConsumerApplication(pipeline, { ackMode: SqsConsumerAckMode.PerMessage });

    const messages = Array.from({ length: 60 }, (_v, i) => message(i % 2 === 0 ? `ok-${i}` : `fail-${i}`));
    const event = { Messages: messages } as ReceiveMessageCommandOutput;
    const expectedFailed = messages.map((m) => m.MessageId!).filter((id) => id.startsWith('fail')).sort();

    for (let run = 0; run < 10; run++) {
      const result = await application.handleAsync(event, createResolverFactory());
      const reportedFailed = result.failedMessages.map((m) => m.MessageId!).sort();
      expect(reportedFailed).toEqual(expectedFailed);
      expect(result.successfulMessages.length).toBe(30);
    }
  });

  it('defaults SqsConsumerOptions.ackMode-driven deletion to PerMessage-safe behaviour (unset outcome is a failure)', async () => {
    // An unrouted message whose result setter never ran (undefined messageResult) must NOT be counted
    // successful (which would delete it) — it stays for redelivery/DLQ redrive.
    const pipeline: IMiddlewarePipeline<SqsConsumerMessageContext> = {
      handleAsync: () => Promise.resolve(), // never sets messageResult
    };
    const application = new SqsConsumerApplication(pipeline, { ackMode: SqsConsumerAckMode.PerMessage });

    const result = await application.handleAsync(
      { Messages: [message('unrouted')] } as ReceiveMessageCommandOutput,
      createResolverFactory(),
    );

    expect(result.successfulMessages).toHaveLength(0);
    expect(result.failedMessages).toHaveLength(1);
    expect(result.failedMessages[0]!.MessageId).toBe('unrouted');
  });

  it('WholeBatch propagates when one message throws', async () => {
    const pipeline: IMiddlewarePipeline<SqsConsumerMessageContext> = {
      handleAsync: (context) => {
        if (context.message.MessageId === 'fails') {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve();
      },
    };
    const application = new SqsConsumerApplication(pipeline, { ackMode: SqsConsumerAckMode.WholeBatch });

    await expect(
      application.handleAsync(
        { Messages: [message('succeeds'), message('fails')] } as ReceiveMessageCommandOutput,
        createResolverFactory(),
      ),
    ).rejects.toThrow('boom');
  });

  it('PerMessage returns a split result without throwing when one message throws', async () => {
    const pipeline: IMiddlewarePipeline<SqsConsumerMessageContext> = {
      handleAsync: (context) => {
        if (context.message.MessageId === 'fails') {
          return Promise.reject(new Error('boom'));
        }
        context.messageResult = BenzeneResult.ok();
        return Promise.resolve();
      },
    };
    const application = new SqsConsumerApplication(pipeline, { ackMode: SqsConsumerAckMode.PerMessage });

    const result = await application.handleAsync(
      { Messages: [message('succeeds'), message('fails')] } as ReceiveMessageCommandOutput,
      createResolverFactory(),
    );

    expect(result.successfulMessages.map((m) => m.MessageId)).toEqual(['succeeds']);
    expect(result.failedMessages.map((m) => m.MessageId)).toEqual(['fails']);
  });

  it('PerMessage excludes a handler failure result from successful messages', async () => {
    const pipeline = resultByIdPipeline((id) => id === 'succeeds');
    const application = new SqsConsumerApplication(pipeline, { ackMode: SqsConsumerAckMode.PerMessage });

    const result = await application.handleAsync(
      { Messages: [message('succeeds'), message('fails')] } as ReceiveMessageCommandOutput,
      createResolverFactory(),
    );

    expect(result.successfulMessages.map((m) => m.MessageId)).toEqual(['succeeds']);
    expect(result.failedMessages.map((m) => m.MessageId)).toEqual(['fails']);
  });
});

describe('SqsConsumerMessageTopicGetter', () => {
  it('returns the missing topic id when there is no topic attribute', () => {
    const context = SqsConsumerMessageContext.createInstance({ MessageAttributes: {} });
    expect(new SqsConsumerMessageTopicGetter().getTopic(context)!.id).toBe('<missing>');
  });

  it('returns the missing topic id when MessageAttributes is absent, without throwing', () => {
    const context = SqsConsumerMessageContext.createInstance({});
    expect(new SqsConsumerMessageTopicGetter().getTopic(context)!.id).toBe('<missing>');
  });

  it('lets a preset topic override a missing topic attribute', () => {
    const context = SqsConsumerMessageContext.createInstance({ MessageAttributes: {} });
    const holder = new PresetTopicHolder();
    holder.presetTopic = new Topic('preset-topic');
    const getter = new PresetTopicMessageTopicGetter<SqsConsumerMessageContext>(
      new SqsConsumerMessageTopicGetter(),
      holder,
    );
    expect(getter.getTopic(context)!.id).toBe('preset-topic');
  });

  it('reads a custom attribute key when configured', () => {
    const context = SqsConsumerMessageContext.createInstance({
      MessageAttributes: { 'x-my-topic': { StringValue: 'some-topic', DataType: 'String' } },
    });
    expect(new SqsConsumerMessageTopicGetter('x-my-topic').getTopic(context)!.id).toBe('some-topic');
  });
});

describe('SqsConsumerMessageHeadersGetter', () => {
  it('returns only string-typed attributes', () => {
    const context = SqsConsumerMessageContext.createInstance({
      MessageAttributes: {
        topic: { DataType: 'String', StringValue: 'some-topic' },
        count: { DataType: 'Number', StringValue: '5' },
      },
    });
    const headers = new SqsConsumerMessageHeadersGetter().getHeaders(context);
    expect(headers['topic']).toBe('some-topic');
    expect('count' in headers).toBe(false);
  });
});

describe('SqsConsumerConfig / polish', () => {
  it('defaults waitTimeSeconds to 20 (max long polling)', () => {
    expect(withConfigDefaults({ queueUrl: 'q', maxNumberOfMessages: 10 }).waitTimeSeconds).toBe(20);
  });

  it('parses ApproximateReceiveCount from the system attribute', () => {
    const context = SqsConsumerMessageContext.createInstance({ Attributes: { ApproximateReceiveCount: '3' } });
    expect(context.approximateReceiveCount).toBe(3);
  });

  it('reports ApproximateReceiveCount as undefined when absent', () => {
    expect(SqsConsumerMessageContext.createInstance({}).approximateReceiveCount).toBeUndefined();
  });

  it('defaults to PerMessage semantics when ackMode is unset (a throw is contained, not propagated)', async () => {
    // C# defaults SqsConsumerOptions.AckMode to PerMessage; the ported interface leaves ackMode unset,
    // so unset must behave as PerMessage — a throwing message is contained and returned as failed.
    const pipeline: IMiddlewarePipeline<SqsConsumerMessageContext> = {
      handleAsync: async (context) => {
        if (context.message.MessageId === 'fails') {
          throw new Error('boom');
        }
        context.messageResult = BenzeneResult.ok();
      },
    };
    const application = new SqsConsumerApplication(pipeline); // no options -> defaults

    const result = await application.handleAsync(
      { Messages: [message('succeeds'), message('fails')] } as ReceiveMessageCommandOutput,
      createResolverFactory(),
    );

    expect(result.successfulMessages.map((m) => m.MessageId)).toEqual(['succeeds']);
    expect(result.failedMessages.map((m) => m.MessageId)).toEqual(['fails']);
  });
});

describe('useSqs', () => {
  it('returns the same startup and registers a worker', () => {
    const container = new DefaultBenzeneServiceContainer();
    const app: IBenzeneWorkerStartup = new BenzeneWorkerBuilder(container);
    const mockFactory: ISqsClientFactory = { create: () => ({}) as ISqsConsumerClient };
    const config: SqsConsumerConfig = { queueUrl: 'some-url', maxNumberOfMessages: 10 };

    const result = useSqs(app, config, mockFactory, (pipeline) => useMessageHandlers(pipeline));
    expect(result).toBe(app);

    const worker = app.createWorker(container.createServiceResolverFactory());
    expect(worker).toBeDefined();
  });
});

describe('SqsConsumer (poll loop)', () => {
  it('receives a batch, runs it through the pipeline, and deletes the successful messages', async () => {
    const seenBodies: string[] = [];
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async (context, next) => {
      seenBodies.push(context.message.Body ?? '');
      context.messageResult = BenzeneResult.ok();
      await next();
    });
    const application = new SqsConsumerApplication(builder.build());

    const controller = new AbortController();
    const deletedEntries: DeleteMessageBatchCommandInput['Entries'][] = [];
    let receiveCalls = 0;
    const client: ISqsConsumerClient = {
      receiveMessageAsync: (_req: ReceiveMessageCommandInput): Promise<ReceiveMessageCommandOutput> => {
        receiveCalls++;
        if (receiveCalls === 1) {
          return Promise.resolve({
            Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'hello' }],
          } as ReceiveMessageCommandOutput);
        }
        // Stop the loop after the first non-empty poll has been fully handled.
        controller.abort();
        return Promise.resolve({ Messages: [], $metadata: {} } as ReceiveMessageCommandOutput);
      },
      deleteMessageBatchAsync: (req: DeleteMessageBatchCommandInput): Promise<DeleteMessageBatchCommandOutput> => {
        deletedEntries.push(req.Entries);
        return Promise.resolve({ Successful: [], Failed: [] } as unknown as DeleteMessageBatchCommandOutput);
      },
    };
    const factory: ISqsClientFactory = { create: () => client };

    const consumer = new SqsConsumer(
      serviceResolverFactory,
      application,
      { queueUrl: 'q', maxNumberOfMessages: 10, waitTimeSeconds: 0 },
      factory,
    );

    await consumer.startAsync(controller.signal);

    expect(seenBodies).toEqual(['hello']);
    expect(deletedEntries).toHaveLength(1);
    expect(deletedEntries[0]).toEqual([{ Id: 'm1', ReceiptHandle: 'r1' }]);
  });

  it('does not delete a message whose result was not successful (PerMessage default)', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    const serviceResolverFactory = container.createServiceResolverFactory();

    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async (context, next) => {
      context.messageResult = BenzeneResult.unexpectedError();
      await next();
    });
    const application = new SqsConsumerApplication(builder.build());

    const controller = new AbortController();
    let receiveCalls = 0;
    let deleteCalls = 0;
    const client: ISqsConsumerClient = {
      receiveMessageAsync: (): Promise<ReceiveMessageCommandOutput> => {
        receiveCalls++;
        if (receiveCalls === 1) {
          return Promise.resolve({
            Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'hello' }],
          } as ReceiveMessageCommandOutput);
        }
        controller.abort();
        return Promise.resolve({ Messages: [], $metadata: {} } as ReceiveMessageCommandOutput);
      },
      deleteMessageBatchAsync: (): Promise<DeleteMessageBatchCommandOutput> => {
        deleteCalls++;
        return Promise.resolve({ Successful: [], Failed: [] } as unknown as DeleteMessageBatchCommandOutput);
      },
    };

    const consumer = new SqsConsumer(
      serviceResolverFactory,
      application,
      { queueUrl: 'q', maxNumberOfMessages: 10, waitTimeSeconds: 0 },
      { create: () => client },
    );

    await consumer.startAsync(controller.signal);

    // A failed result is never deleted — no delete call is made at all for the single failing message.
    expect(deleteCalls).toBe(0);
  });
});
