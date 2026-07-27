import { describe, expect, it } from 'vitest';
import { SQSEvent, SQSRecord } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult } from '@benzene/results';
import { BenzeneException } from '@benzene/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  addSqs,
  SqsApplication,
  SqsBatchFailureMode,
  SqsBatchProcessingException,
  SqsMessageContext,
  SqsOptions,
  useSqs,
} from '@benzene/aws-lambda-sqs';
import { benzeneTestHost, messageBuilder } from '@benzene/testing';
import { asSqs, type AwsLambdaStartUp } from '@benzene/aws-lambda-testing';

/**
 * End-to-end port of the C# SQS pipeline tests (test/Benzene.Core.Test/Aws/Sqs/SqsMessagePipelineTest.cs
 * and SqsBatchFailureModeTest.cs): wire the full stack via idiomatic DI and feed realistic SQSEvents
 * through the Lambda entry point / SQS router / message-handler pipeline.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

// Records which orders reached the handler, proving the SQS record genuinely routed to it.
const handled: string[] = [];

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createSqsRecord(messageId: string, topic: string | undefined, body: unknown): SQSRecord {
  return {
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body: JSON.stringify(body),
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '0',
      SenderId: 'sender',
      ApproximateFirstReceiveTimestamp: '0',
    },
    messageAttributes:
      topic === undefined ? {} : { topic: { stringValue: topic, dataType: 'String' } },
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:queue',
    awsRegion: 'us-east-1',
  };
}

function createSqsEvent(
  records: { messageId: string; topic?: string; body: unknown }[],
): SQSEvent {
  return { Records: records.map((r) => createSqsRecord(r.messageId, r.topic, r.body)) };
}

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`). The single-record case
// uses the `asSqs` event builder; the mixed-topic partial-batch case keeps a hand-rolled event since it
// needs per-record topics and message ids the builder does not express.
class SqsStartUp implements AwsLambdaStartUp {
  configureServices = (services: Parameters<AwsLambdaStartUp['configureServices']>[0]): void => {
    addBenzene(services);
  };

  configure(app: Parameters<AwsLambdaStartUp['configure']>[0]): void {
    useSqs(app, (sqs) => useMessageHandlers(sqs, CreateOrderHandler));
  }
}

describe('SqsPipeline (via the benzeneTestHost harness)', () => {
  it('routes an SQS record to a decorated handler and returns an empty batch response', async () => {
    handled.length = 0;

    const host = benzeneTestHost(SqsStartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync<{
      batchItemFailures: { itemIdentifier: string }[];
    }>(asSqs(messageBuilder('create-order', { orderId: '42' })));

    // The handler genuinely ran with the deserialized body...
    expect(handled).toEqual(['42']);
    // ...and no record was reported as failed.
    expect(response.batchItemFailures).toEqual([]);
  });

  it('reports an unroutable record in batchItemFailures (partial batch failure)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(SqsStartUp).buildAwsLambdaHost();

    const event = createSqsEvent([
      { messageId: 'ok', topic: 'create-order', body: { orderId: '1' } },
      { messageId: 'bad', topic: 'no-such-topic', body: { orderId: '2' } },
    ]);

    const response = await host.sendEventAsync<{
      batchItemFailures: { itemIdentifier: string }[];
    }>(event);

    expect(handled).toEqual(['1']);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: 'bad' }]);
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const host = benzeneTestHost(SqsStartUp).buildAwsLambdaHost();

    // An event with no records / no aws:sqs source is not handled by the SQS router, so
    // `context.response` stays undefined and the entry point raises the recognition error.
    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
  });
});

describe('SqsApplication (direct)', () => {
  it('runs every record through the pipeline in its own scope', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSqs(container);

    const seenBodies: string[] = [];
    const pipeline = new MiddlewarePipelineBuilder<SqsMessageContext>(container);
    pipeline.useFn(async (context, next) => {
      seenBodies.push(context.sqsMessage.body);
      await next();
    });

    const application = new SqsApplication(pipeline.build());
    const event = createSqsEvent([
      { messageId: 'a', topic: 'create-order', body: { orderId: '1' } },
      { messageId: 'b', topic: 'create-order', body: { orderId: '2' } },
    ]);

    const response = await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenBodies.sort()).toEqual(
      [JSON.stringify({ orderId: '1' }), JSON.stringify({ orderId: '2' })].sort(),
    );
    expect(response.batchItemFailures).toEqual([]);
  });

  it('FailWholeBatch throws SqsBatchProcessingException listing failed message ids', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSqs(container);

    const builder = new MiddlewarePipelineBuilder<SqsMessageContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new SqsOptions();
    options.batchFailureMode = SqsBatchFailureMode.FailWholeBatch;
    const application = new SqsApplication(builder.build(), options);

    // Unroutable topic -> handler result is not successful -> a failure exists -> whole batch throws.
    const event = createSqsEvent([
      { messageId: 'fails', topic: 'no-such-topic', body: { orderId: '9' } },
    ]);

    await expect(
      application.handleAsync(event, container.createServiceResolverFactory()),
    ).rejects.toThrow(SqsBatchProcessingException);
  });

  it('SqsOptions defaults to PartialBatchFailure', () => {
    expect(new SqsOptions().batchFailureMode).toBe(SqsBatchFailureMode.PartialBatchFailure);
  });
});
