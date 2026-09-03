import { describe, expect, it } from 'vitest';
import type {
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';
import { ILoggerFactory, IServiceResolverFactory } from '@benzenejs/abstractions';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import {
  ISqsConsumerClient,
  SqsConsumer,
  SqsConsumerApplication,
  SqsConsumerMessageContext,
} from '@benzenejs/aws-sqs';
import { FakeLoggerFactory } from '../../Logging/Helpers/FakeLoggerFactory';

/**
 * Port of test/Benzene.Core.Test/Aws/Sqs/SqsConsumerCancellationTest.cs's shutdown-race tests
 * (.NET R10 #115): settling already-handled messages is part of graceful drain, so the delete must
 * NOT be gated on the (now-fired) stop signal, and a message whose handler observed the shutdown
 * and threw must NOT be deleted. `CancellationToken.None` maps to passing no `AbortSignal` at all.
 */

function createContainer(loggerFactory?: FakeLoggerFactory): {
  container: DefaultBenzeneServiceContainer;
  serviceResolverFactory: IServiceResolverFactory;
} {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  if (loggerFactory !== undefined) {
    container.addSingletonInstance(ILoggerFactory, loggerFactory);
  }
  return { container, serviceResolverFactory: container.createServiceResolverFactory() };
}

const config = { queueUrl: 'https://example/queue', maxNumberOfMessages: 10, waitTimeSeconds: 0 };

describe('SqsConsumer shutdown race (settlement is cancellation-detached)', () => {
  it('#115: shutdown firing after the handler succeeds still deletes the message, without the stop signal', async () => {
    const { container, serviceResolverFactory } = createContainer();

    const controller = new AbortController();
    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async (context, next) => {
      context.messageResult = BenzeneResult.ok();
      // The host's shutdown signal fires right after the handler finished successfully but before
      // the batch has been deleted.
      controller.abort();
      await next();
    });
    const application = new SqsConsumerApplication(builder.build());

    let deleteCalls = 0;
    const deleteSignals: (AbortSignal | undefined)[] = [];
    const client: ISqsConsumerClient = {
      receiveMessageAsync: (): Promise<ReceiveMessageCommandOutput> =>
        Promise.resolve({
          Messages: [{ MessageId: 'done', ReceiptHandle: 'r1', Body: 'test' }],
        } as ReceiveMessageCommandOutput),
      deleteMessageBatchAsync: (
        _req: DeleteMessageBatchCommandInput,
        signal?: AbortSignal,
      ): Promise<DeleteMessageBatchCommandOutput> => {
        deleteCalls++;
        deleteSignals.push(signal);
        // Mirror what a real SDK send does when handed an already-fired signal: reject. This is
        // exactly what would have happened pre-fix, when the (aborted) run signal was passed through.
        if (signal?.aborted) {
          return Promise.reject(new Error('AbortError'));
        }
        return Promise.resolve({ Successful: [], Failed: [] } as unknown as DeleteMessageBatchCommandOutput);
      },
    };

    const consumer = new SqsConsumer(serviceResolverFactory, application, config, {
      create: () => client,
    });

    await consumer.startAsync(controller.signal);

    // The delete went through exactly once, detached from the (fired) stop signal.
    expect(deleteCalls).toBe(1);
    expect(deleteSignals).toEqual([undefined]);
  });

  it('a handler that observes the shutdown and throws leaves the message undeleted', async () => {
    const { container, serviceResolverFactory } = createContainer(new FakeLoggerFactory());

    const controller = new AbortController();
    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async () => {
      // Shutdown fires mid-handler; the handler surfaces it as a throw (the OCE-shaped port).
      controller.abort();
      throw new Error('aborted mid-message');
    });
    const application = new SqsConsumerApplication(builder.build());

    let deleteCalls = 0;
    let receiveCalls = 0;
    const client: ISqsConsumerClient = {
      receiveMessageAsync: (): Promise<ReceiveMessageCommandOutput> => {
        receiveCalls++;
        return Promise.resolve({
          Messages: [{ MessageId: 'in-flight', ReceiptHandle: 'r1', Body: 'test' }],
        } as ReceiveMessageCommandOutput);
      },
      deleteMessageBatchAsync: (): Promise<DeleteMessageBatchCommandOutput> => {
        deleteCalls++;
        return Promise.resolve({} as DeleteMessageBatchCommandOutput);
      },
    };

    const consumer = new SqsConsumer(serviceResolverFactory, application, config, {
      create: () => client,
    });

    await consumer.startAsync(controller.signal);

    // Failed (not settled) work is left for redelivery; the loop exited after one poll.
    expect(deleteCalls).toBe(0);
    expect(receiveCalls).toBe(1);
  });

  it('an already-fired stop signal starts no new work', async () => {
    const { container, serviceResolverFactory } = createContainer();

    let pipelineRuns = 0;
    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async (_context, next) => {
      pipelineRuns++;
      await next();
    });
    const application = new SqsConsumerApplication(builder.build());

    const controller = new AbortController();
    controller.abort();

    let deleteCalls = 0;
    const client: ISqsConsumerClient = {
      // The real SqsClientFactory wrapper hands the signal to the SDK, which rejects immediately
      // when it has already fired — reproduced here so the loop's abort path is exercised.
      receiveMessageAsync: (_req, signal?: AbortSignal): Promise<ReceiveMessageCommandOutput> =>
        signal?.aborted
          ? Promise.reject(new Error('AbortError'))
          : Promise.resolve({ Messages: [] } as unknown as ReceiveMessageCommandOutput),
      deleteMessageBatchAsync: (): Promise<DeleteMessageBatchCommandOutput> => {
        deleteCalls++;
        return Promise.resolve({} as DeleteMessageBatchCommandOutput);
      },
    };

    await new SqsConsumer(serviceResolverFactory, application, config, {
      create: () => client,
    }).startAsync(controller.signal);

    expect(pipelineRuns).toBe(0);
    expect(deleteCalls).toBe(0);
  });

  it('a failing delete call is logged as a settlement failure, not a poll failure', async () => {
    const loggerFactory = new FakeLoggerFactory();
    const { container, serviceResolverFactory } = createContainer(loggerFactory);

    const controller = new AbortController();
    const builder = new MiddlewarePipelineBuilder<SqsConsumerMessageContext>(container);
    builder.useFn(async (context, next) => {
      context.messageResult = BenzeneResult.ok();
      controller.abort();
      await next();
    });
    const application = new SqsConsumerApplication(builder.build());

    const client: ISqsConsumerClient = {
      receiveMessageAsync: (): Promise<ReceiveMessageCommandOutput> =>
        Promise.resolve({
          Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: 'test' }],
        } as ReceiveMessageCommandOutput),
      deleteMessageBatchAsync: (): Promise<DeleteMessageBatchCommandOutput> =>
        Promise.reject(new Error('network blip during drain')),
    };

    await new SqsConsumer(serviceResolverFactory, application, config, {
      create: () => client,
    }).startAsync(controller.signal);

    // The batch will be redelivered — say so...
    expect(loggerFactory.collector.entries.some((e) => e.message.includes('will be redelivered'))).toBe(
      true,
    );
    // ...and never misreport a settlement failure as a receive/poll failure (which drives backoff).
    expect(loggerFactory.collector.entries.some((e) => e.message.includes('poll iteration'))).toBe(
      false,
    );
  });
});
