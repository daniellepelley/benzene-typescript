/**
 * One-way binding settlement (transport-bindings §1, obligation 8; spec-0.2.0 D16): a failure result, a
 * missing result and an uncaught error are not acknowledged; success (`ignored` included) is; an unmatched
 * topic is a `not-found` failure unless `ignoreUnmatchedTopics`; `atMostOnce` acknowledges everything; a
 * stream binding may skip-and-continue for a missing result / unmatched topic and documents it.
 *
 * TypeScript-only suite: .NET pins the same rules per binding in each binding's own pipeline test.
 */
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer, VoidResult } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  isSettledAsFailure,
  isUnmatchedTopic,
  markUnmatchedTopic,
  message,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { messageBuilder } from '@benzenejs/testing';
import { asDynamoDb, asKinesis, asS3, asSns, asSqs } from '@benzenejs/aws-lambda-testing';
import { addSqs, SqsApplication, SqsMessageContext, SqsOptions } from '@benzenejs/aws-lambda-sqs';
import { addSns, SnsApplication, SnsMessageProcessingException, SnsOptions, SnsRecordContext } from '@benzenejs/aws-lambda-sns';
import { addS3, S3Application, S3MessageProcessingException, S3RecordContext } from '@benzenejs/aws-lambda-s3';
import { addDynamoDb, DynamoDbApplication, DynamoDbRecordContext } from '@benzenejs/aws-lambda-dynamodb';
import {
  addKinesis,
  KinesisApplication,
  KinesisMessageContext,
  KinesisMessageProcessingException,
  KinesisOptions,
} from '@benzenejs/aws-lambda-kinesis';
import {
  addKafka as addMskKafka,
  KafkaApplication as MskKafkaApplication,
  KafkaBatchFailureMode,
  KafkaBatchProcessingException,
  KafkaContext as MskKafkaContext,
  KafkaOptions as MskKafkaOptions,
} from '@benzenejs/aws-lambda-kafka';
import { TimerApplication, TimerContext, TimerMessageProcessingException, TimerOptions, TimerTriggerInfo } from '@benzenejs/azure-function-timer';
import { EventHubBatchApplication, EventHubContext, EventHubMessageProcessingException } from '@benzenejs/azure-function-event-hub';
import { MSKEvent } from 'aws-lambda';

@message('settle:known', { register: false, requestType: VoidResult, responseType: VoidResult })
class KnownHandler implements IMessageHandler<VoidResult, VoidResult> {
  handleAsync(): Promise<IBenzeneResultOf<VoidResult>> {
    return Promise.resolve(BenzeneResult.ok());
  }
}

type Outcome = 'ok' | 'failure' | 'none' | 'throw';

/** A pipeline whose single middleware records the given outcome on the context (or none, or throws). */
function outcomePipeline<TContext extends { messageResult?: unknown }>(
  container: IBenzeneServiceContainer,
  outcome: Outcome | ((context: TContext) => Outcome),
) {
  const builder = new MiddlewarePipelineBuilder<TContext>(container);
  builder.useFn((context) => {
    const chosen = typeof outcome === 'function' ? outcome(context) : outcome;
    if (chosen === 'throw') {
      throw new Error('boom');
    }
    if (chosen === 'ok') {
      context.messageResult = BenzeneResult.ok();
    } else if (chosen === 'failure') {
      context.messageResult = BenzeneResult.validationError('bad');
    }
    return Promise.resolve();
  });
  return builder.build();
}

function containerWith(register: (c: IBenzeneServiceContainer) => void): DefaultBenzeneServiceContainer {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  register(container);
  return container;
}

describe('the settlement decision', () => {
  it('redelivers a failure and a missing result, acknowledges a success (ignored included)', () => {
    expect(isSettledAsFailure(BenzeneResult.validationError('x'))).toBe(true);
    expect(isSettledAsFailure(undefined)).toBe(true);
    expect(isSettledAsFailure(BenzeneResult.ok())).toBe(false);
    expect(isSettledAsFailure(BenzeneResult.ignored())).toBe(false);
  });

  it('lets a stream acknowledge a missing result, and recognises only the router-marked not-found as unmatched', () => {
    expect(isSettledAsFailure(undefined, { missingResult: 'acknowledge' })).toBe(false);

    const handlerNotFound = BenzeneResult.notFound('no such order');
    const unmatched = markUnmatchedTopic(BenzeneResult.notFound('no handler'));
    expect(isUnmatchedTopic(handlerNotFound)).toBe(false);
    expect(isUnmatchedTopic(unmatched)).toBe(true);
    expect(isSettledAsFailure(handlerNotFound, { ignoreUnmatchedTopics: true })).toBe(true);
    expect(isSettledAsFailure(unmatched, { ignoreUnmatchedTopics: true })).toBe(false);
    // The mark never reaches the wire.
    expect(JSON.stringify(unmatched)).toBe(JSON.stringify(BenzeneResult.notFound('no handler')));
  });
});

describe('queue: Lambda SQS', () => {
  const event = asSqs(messageBuilder('settle:unknown', {}));

  it('reports a missing result as a batch item failure', async () => {
    const container = containerWith(addSqs);
    const response = await new SqsApplication(outcomePipeline<SqsMessageContext>(container, 'none')).handleAsync(
      event,
      container.createServiceResolverFactory(),
    );
    expect(response.batchItemFailures).toHaveLength(1);
  });

  it('reports an unmatched topic, unless ignoreUnmatchedTopics', async () => {
    const container = containerWith(addSqs);
    const builder = new MiddlewarePipelineBuilder<SqsMessageContext>(container);
    useMessageHandlers(builder, KnownHandler);
    const pipeline = builder.build();

    const strict = await new SqsApplication(pipeline).handleAsync(event, container.createServiceResolverFactory());
    expect(strict.batchItemFailures).toHaveLength(1);

    const options = new SqsOptions();
    options.ignoreUnmatchedTopics = true;
    const lenient = await new SqsApplication(pipeline, options).handleAsync(event, container.createServiceResolverFactory());
    expect(lenient.batchItemFailures).toHaveLength(0);
  });

  it('acknowledges a failure and an exception under atMostOnce', async () => {
    const container = containerWith(addSqs);
    const options = new SqsOptions();
    options.atMostOnce = true;
    for (const outcome of ['failure', 'throw'] as const) {
      const response = await new SqsApplication(outcomePipeline<SqsMessageContext>(container, outcome), options).handleAsync(
        event,
        container.createServiceResolverFactory(),
      );
      expect(response.batchItemFailures).toEqual([]);
    }
  });
});

describe('one-shot: Lambda SNS and S3', () => {
  it('SNS fails the invocation on a missing result by default, and acknowledges it under atMostOnce', async () => {
    const container = containerWith(addSns);
    const event = asSns(messageBuilder('settle:any', {}));

    await expect(
      new SnsApplication(outcomePipeline<SnsRecordContext>(container, 'none')).handleAsync(event, container.createServiceResolverFactory()),
    ).rejects.toThrow(SnsMessageProcessingException);

    const options = new SnsOptions();
    options.atMostOnce = true;
    await expect(
      new SnsApplication(outcomePipeline<SnsRecordContext>(container, 'throw'), options).handleAsync(
        event,
        container.createServiceResolverFactory(),
      ),
    ).resolves.toBeUndefined();
  });

  it('S3 fails the invocation on a failure result', async () => {
    const container = containerWith(addS3);
    await expect(
      new S3Application(outcomePipeline<S3RecordContext>(container, 'failure')).handleAsync(
        asS3('bucket', 'key'),
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(S3MessageProcessingException);
  });
});

describe('stream: DynamoDB Streams, Kinesis, MSK', () => {
  it('DynamoDB stops at a record with no result and reports its sequence number', async () => {
    const container = containerWith(addDynamoDb);
    const response = await new DynamoDbApplication(outcomePipeline<DynamoDbRecordContext>(container, 'none')).handleAsync(
      asDynamoDb(messageBuilder('orders:INSERT', { id: '1' })),
      container.createServiceResolverFactory(),
    );
    expect(response.batchItemFailures).toHaveLength(1);
  });

  it('Kinesis fails the invocation on a failure result, but skips a missing result (documented carve-out)', async () => {
    const container = containerWith(addKinesis);
    const event = asKinesis(messageBuilder('settle:any', {}));

    await expect(
      new KinesisApplication(outcomePipeline<KinesisMessageContext>(container, 'failure')).handleAsync(
        event,
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(KinesisMessageProcessingException);

    await expect(
      new KinesisApplication(outcomePipeline<KinesisMessageContext>(container, 'none')).handleAsync(
        event,
        container.createServiceResolverFactory(),
      ),
    ).resolves.toBeUndefined();

    expect(new KinesisOptions().ignoreUnmatchedTopics).toBe(true);
  });

  const mskEvent: MSKEvent = {
    eventSource: 'aws:kafka',
    eventSourceArn: 'arn',
    bootstrapServers: 'b',
    records: {
      'orders-0': [0, 1, 2].map((offset) => ({
        topic: 'orders',
        partition: 0,
        offset,
        timestamp: 0,
        timestampType: 'CREATE_TIME' as const,
        key: '',
        value: Buffer.from('{}').toString('base64'),
        headers: [],
      })),
      'orders-1': [{ topic: 'orders', partition: 1, offset: 7, timestamp: 0, timestampType: 'CREATE_TIME' as const, key: '', value: '', headers: [] }],
    },
  };

  it('MSK stops a partition at its first failure and reports { partition, offset }; other partitions proceed', async () => {
    const container = containerWith(addMskKafka);
    const seen: string[] = [];
    const pipeline = outcomePipeline<MskKafkaContext>(container, (context) => {
      const record = context.kafkaEventRecord;
      seen.push(`${record.partition}@${record.offset}`);
      return record.partition === 0 && record.offset === 1 ? 'failure' : 'ok';
    });

    const response = await new MskKafkaApplication(pipeline).handleAsync(mskEvent, container.createServiceResolverFactory());

    expect(response.batchItemFailures).toEqual([{ itemIdentifier: { partition: 'orders-0', offset: 1 } }]);
    expect(seen).not.toContain('0@2');
    expect(seen).toContain('1@7');
  });

  it('MSK skips a missing result (stream carve-out) and fails the whole batch under FailWholeBatch', async () => {
    const container = containerWith(addMskKafka);
    const skipping = await new MskKafkaApplication(outcomePipeline<MskKafkaContext>(container, 'none')).handleAsync(
      mskEvent,
      container.createServiceResolverFactory(),
    );
    expect(skipping.batchItemFailures).toEqual([]);

    const options = new MskKafkaOptions();
    options.batchFailureMode = KafkaBatchFailureMode.FailWholeBatch;
    await expect(
      new MskKafkaApplication(outcomePipeline<MskKafkaContext>(container, 'failure'), options).handleAsync(
        mskEvent,
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(KafkaBatchProcessingException);
  });
});

describe('Azure Functions: Timer and Event Hub triggers', () => {
  it('Timer fails the invocation on a failure result, not on a plain tick with no result', async () => {
    const container = containerWith(() => undefined);
    const factory = container.createServiceResolverFactory();

    await expect(
      new TimerApplication(outcomePipeline<TimerContext>(container, 'failure'), factory).sendAsync(new TimerTriggerInfo()),
    ).rejects.toThrow(TimerMessageProcessingException);
    await expect(
      new TimerApplication(outcomePipeline<TimerContext>(container, 'none'), factory).sendAsync(new TimerTriggerInfo()),
    ).resolves.toBeUndefined();

    const options = new TimerOptions();
    options.atMostOnce = true;
    await expect(
      new TimerApplication(outcomePipeline<TimerContext>(container, 'throw'), factory, options).sendAsync(new TimerTriggerInfo()),
    ).resolves.toBeUndefined();
  });

  it('Event Hub fails the invocation on a failure result, and skips a missing result (stream carve-out)', async () => {
    const container = containerWith(() => undefined);
    const events = [{ body: '{}', sequenceNumber: 5 }] as unknown as Parameters<EventHubBatchApplication['handleAsync']>[0];

    await expect(
      new EventHubBatchApplication(outcomePipeline<EventHubContext>(container, 'failure')).handleAsync(
        events,
        container.createServiceResolverFactory(),
      ),
    ).rejects.toThrow(EventHubMessageProcessingException);
    await expect(
      new EventHubBatchApplication(outcomePipeline<EventHubContext>(container, 'none')).handleAsync(
        events,
        container.createServiceResolverFactory(),
      ),
    ).resolves.toBeUndefined();
  });
});
