import { describe, expect, it } from 'vitest';
import { Context, DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';
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
import { InlineAwsLambdaStartUp } from '@benzene/aws-lambda-core';
import {
  addDynamoDb,
  DynamoDbApplication,
  DynamoDbRecordContext,
  useDynamoDb,
} from '@benzene/aws-lambda-dynamodb';

/**
 * End-to-end port of the C# DynamoDB pipeline tests
 * (test/Benzene.Core.Test/Aws/DynamoDb/DynamoDbMessagePipelineTest.cs): wire the full stack via idiomatic
 * DI and feed realistic DynamoDBStreamEvents through the Lambda entry point / DynamoDB router /
 * message-handler pipeline. Topic = `"{table}:{eventName}"`; body = the AttributeValue image unmarshalled
 * to plain JSON. Batch processing is SEQUENTIAL and STOPS at the first failed record.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('orders:INSERT', { registry, requestType: Order, responseType: OrderCreated })
class OrderInsertedHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

const streamArn = 'arn:aws:dynamodb:us-east-1:123456789012:table/orders/stream/2021-01-01T00:00:00.000';

function createDynamoDbRecord(
  sequenceNumber: string,
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  orderId: string,
): DynamoDBRecord {
  return {
    eventID: `event-${sequenceNumber}`,
    eventName,
    eventVersion: '1.1',
    eventSource: 'aws:dynamodb',
    eventSourceARN: streamArn,
    awsRegion: 'us-east-1',
    dynamodb: {
      SequenceNumber: sequenceNumber,
      StreamViewType: 'NEW_AND_OLD_IMAGES',
      SizeBytes: 1,
      NewImage: { orderId: { S: orderId } },
    },
  };
}

function createDynamoDbEvent(
  records: { sequenceNumber: string; eventName: 'INSERT' | 'MODIFY' | 'REMOVE'; orderId: string }[],
): DynamoDBStreamEvent {
  return { Records: records.map((r) => createDynamoDbRecord(r.sequenceNumber, r.eventName, r.orderId)) };
}

const fakeLambdaContext = {} as Context;

describe('DynamoDbPipeline (via AwsLambdaEntryPoint)', () => {
  it('routes a stream record to a decorated handler and returns an empty batch response', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useDynamoDb(app, (dynamo) => useMessageHandlers(dynamo, OrderInsertedHandler)),
      )
      .build();

    const event = createDynamoDbEvent([
      { sequenceNumber: '1', eventName: 'INSERT', orderId: '42' },
    ]);

    const response = (await entryPoint.functionHandlerAsync(event, fakeLambdaContext)) as {
      batchItemFailures: { itemIdentifier: string }[];
    };

    // The handler ran with the AttributeValue image unmarshalled to `{ orderId: '42' }`...
    expect(handled).toEqual(['42']);
    // ...and no record was reported as failed.
    expect(response.batchItemFailures).toEqual([]);
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) =>
        useDynamoDb(app, (dynamo) => useMessageHandlers(dynamo, OrderInsertedHandler)),
      )
      .build();

    await expect(entryPoint.functionHandlerAsync({ foo: 'bar' }, fakeLambdaContext)).rejects.toThrow(
      BenzeneException,
    );
  });
});

describe('DynamoDbApplication (direct)', () => {
  it('reports the first failed record sequence number and stops (sequential batching)', async () => {
    handled.length = 0;

    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addDynamoDb(container);

    const builder = new MiddlewarePipelineBuilder<DynamoDbRecordContext>(container);
    useMessageHandlers(builder, OrderInsertedHandler);

    const application = new DynamoDbApplication(builder.build());

    // First record has an unroutable topic (`orders:MODIFY`) -> fails; the second (`orders:INSERT`)
    // must NOT be processed because processing stops at the first failure.
    const event = createDynamoDbEvent([
      { sequenceNumber: '99', eventName: 'MODIFY', orderId: '1' },
      { sequenceNumber: '100', eventName: 'INSERT', orderId: '2' },
    ]);

    const response = await application.handleAsync(event, container.createServiceResolverFactory());

    expect(handled).toEqual([]);
    expect(response.batchItemFailures).toEqual([{ itemIdentifier: '99' }]);
  });
});
