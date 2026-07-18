import { describe, expect, it } from 'vitest';
import { Context, SNSEvent, SNSEventRecord } from 'aws-lambda';
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
  addSns,
  SnsApplication,
  SnsMessageProcessingException,
  SnsOptions,
  SnsRecordContext,
  useSns,
} from '@benzene/aws-lambda-sns';

/**
 * End-to-end port of the C# SNS pipeline tests (test/Benzene.Core.Test/Aws/Sns/SnsMessagePipelineTest.cs
 * and SnsFailureHandlingTest.cs): wire the full stack via idiomatic DI and feed realistic SNSEvents
 * through the Lambda entry point / SNS router / message-handler pipeline. SNS is fire-and-forget, so the
 * router writes the `null` "handled" sentinel and the entry point returns it.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];
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

function createSnsRecord(messageId: string, topic: string | undefined, body: unknown): SNSEventRecord {
  return {
    EventVersion: '1.0',
    EventSubscriptionArn: 'arn:aws:sns:us-east-1:123456789012:topic:subscription',
    EventSource: 'aws:sns',
    Sns: {
      Type: 'Notification',
      MessageId: messageId,
      TopicArn: 'arn:aws:sns:us-east-1:123456789012:topic',
      Message: JSON.stringify(body),
      Timestamp: '1970-01-01T00:00:00.000Z',
      SignatureVersion: '1',
      Signature: 'sig',
      SigningCertUrl: 'https://sns.us-east-1.amazonaws.com/cert.pem',
      UnsubscribeUrl: 'https://sns.us-east-1.amazonaws.com/unsubscribe',
      MessageAttributes:
        topic === undefined ? {} : { topic: { Type: 'String', Value: topic } },
    },
  };
}

function createSnsEvent(
  records: { messageId: string; topic?: string; body: unknown }[],
): SNSEvent {
  return { Records: records.map((r) => createSnsRecord(r.messageId, r.topic, r.body)) };
}

const fakeLambdaContext = {} as Context;

describe('SnsPipeline (via AwsLambdaEntryPoint)', () => {
  it('routes an SNS record to a decorated handler (fire-and-forget)', async () => {
    handled.length = 0;

    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useSns(app, (sns) => useMessageHandlers(sns, CreateOrderHandler)))
      .build();

    const event = createSnsEvent([
      { messageId: 'm1', topic: 'create-order', body: { orderId: '42' } },
    ]);

    const response = await entryPoint.functionHandlerAsync(event, fakeLambdaContext);

    // The handler genuinely ran with the deserialized body...
    expect(handled).toEqual(['42']);
    // ...and SNS is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const entryPoint = new InlineAwsLambdaStartUp()
      .configureServices((services) => addBenzene(services))
      .configure((app) => useSns(app, (sns) => useMessageHandlers(sns, CreateOrderHandler)))
      .build();

    await expect(entryPoint.functionHandlerAsync({ foo: 'bar' }, fakeLambdaContext)).rejects.toThrow(
      BenzeneException,
    );
  });
});

describe('SnsApplication (direct)', () => {
  it('runs every record through the pipeline in its own scope, recording the message result', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const seenMessages: string[] = [];
    let messageResultSuccessful: boolean | undefined;
    const pipeline = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    pipeline
      .useFn(async (context, next) => {
        seenMessages.push(context.snsRecord.Sns.Message);
        await next();
      })
      .onResponse((context) => {
        messageResultSuccessful = context.messageResult?.isSuccessful;
      });
    useMessageHandlers(pipeline, CreateOrderHandler);

    const application = new SnsApplication(pipeline.build());
    const event = createSnsEvent([
      { messageId: 'a', topic: 'create-order', body: { orderId: '1' } },
    ]);

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenMessages).toEqual([JSON.stringify({ orderId: '1' })]);
    expect(messageResultSuccessful).toBe(true);
  });

  it('raiseOnFailureStatus throws SnsMessageProcessingException for an unroutable record', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const builder = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new SnsOptions();
    options.raiseOnFailureStatus = true;
    const application = new SnsApplication(builder.build(), options);

    const event = createSnsEvent([
      { messageId: 'fails', topic: 'no-such-topic', body: { orderId: '9' } },
    ]);

    await expect(
      application.handleAsync(event, container.createServiceResolverFactory()),
    ).rejects.toThrow(SnsMessageProcessingException);
  });

  it('SnsOptions defaults both flags to false', () => {
    const options = new SnsOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(false);
  });
});
