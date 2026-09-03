import { describe, expect, it } from 'vitest';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { SNSClient } from '@aws-sdk/client-sns';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { LambdaClient } from '@aws-sdk/client-lambda';
import type { SFNClient } from '@aws-sdk/client-sfn';
import type { ServiceBusSender } from '@azure/service-bus';
import type { QueueClient } from '@azure/storage-queue';
import type { EventGridPublisherClient, InputSchema } from '@azure/eventgrid';
import type { EventHubProducerClient } from '@azure/event-hubs';
import { InvocationType } from '@aws-sdk/client-lambda';
import { ILogger } from '@benzenejs/abstractions';
import { NextFunc } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { OutboundSqsContextConverter, SqsClientMiddleware } from '@benzenejs/clients-aws-sqs';
import { OutboundSnsContextConverter, SnsClientMiddleware } from '@benzenejs/clients-aws-sns';
import {
  EventBridgeClientMiddleware,
  OutboundEventBridgeContextConverter,
} from '@benzenejs/clients-aws-eventbridge';
import { AwsLambdaClient } from '@benzenejs/clients-aws-lambda';
import { StepFunctionsClient } from '@benzenejs/clients-aws-step-functions';
import {
  OutboundServiceBusContextConverter,
  ServiceBusClientMiddleware,
} from '@benzenejs/clients-azure-service-bus';
import {
  OutboundQueueStorageContextConverter,
  QueueStorageClientMiddleware,
} from '@benzenejs/clients-azure-queue-storage';
import {
  EventGridClientMiddleware,
  OutboundEventGridContextConverter,
  OutboundEventGridEventSchemaContextConverter,
} from '@benzenejs/clients-azure-event-grid';
import {
  EventHubClientMiddleware,
  OutboundEventHubContextConverter,
} from '@benzenejs/clients-azure-event-hub';
import { buildInProcessRequest } from '@benzenejs/clients-in-process';
import { JsonSerializer } from '@benzenejs/core-message-handlers';

/**
 * The W1.3 abort-signal sweep across the outbound client packages (the TS port of the .NET R16
 * #261 / R7-10 #268/#270 cancellation threading): `OutboundContext.signal` is copied onto each
 * transport's send context by its converter, and the terminal client middleware hands it to the
 * underlying SDK call as `abortSignal` wherever the SDK accepts one. Each SDK client is a capturing
 * fake, so the assertions pin the exact signal instance reaching the SDK boundary.
 *
 * Deliberately absent: Google Cloud Pub/Sub (`Topic.publishMessage` accepts no AbortSignal — see the
 * note in `PubSubClientMiddleware`).
 */

const noNext: NextFunc = () => Promise.resolve();

function outboundContext(signal?: AbortSignal): OutboundContext {
  const context = new OutboundContext('orders:placed', { orderId: 'o1' }, {});
  context.signal = signal;
  return context;
}

describe('outbound abort-signal threading', () => {
  const controller = new AbortController();
  const signal = controller.signal;

  it('SQS: converter copies OutboundContext.signal and the middleware passes it as abortSignal', async () => {
    const converter = new OutboundSqsContextConverter('https://queue');
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let captured: unknown;
    const fakeSqs = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({ $metadata: { httpStatusCode: 200 } });
      },
    } as unknown as SQSClient;

    await new SqsClientMiddleware(fakeSqs).handleAsync(sendContext, noNext);
    expect(captured).toBe(signal);
  });

  it('SNS: converter copies OutboundContext.signal and the middleware passes it as abortSignal', async () => {
    const converter = new OutboundSnsContextConverter('arn:aws:sns:eu-west-1:1:topic');
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let captured: unknown;
    const fakeSns = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({ $metadata: { httpStatusCode: 200 } });
      },
    } as unknown as SNSClient;

    await new SnsClientMiddleware(fakeSns).handleAsync(sendContext, noNext);
    expect(captured).toBe(signal);
  });

  it('EventBridge: converter copies OutboundContext.signal and the middleware passes it as abortSignal', async () => {
    const converter = new OutboundEventBridgeContextConverter('bus');
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let captured: unknown;
    const fakeEventBridge = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({ $metadata: { httpStatusCode: 200 }, FailedEntryCount: 0 });
      },
    } as unknown as EventBridgeClient;

    await new EventBridgeClientMiddleware(fakeEventBridge).handleAsync(sendContext, noNext);
    expect(captured).toBe(signal);
  });

  it('Lambda: sendMessageAsync passes its signal parameter as abortSignal', async () => {
    let captured: unknown;
    const fakeLambda = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({ Payload: new TextEncoder().encode('{"ok":true}') });
      },
    } as unknown as LambdaClient;

    const client = new AwsLambdaClient(fakeLambda);
    await client.sendMessageAsync({ orderId: 'o1' }, 'fn', InvocationType.RequestResponse, signal);
    expect(captured).toBe(signal);
  });

  it('Step Functions: startExecutionAsync passes its signal parameter as abortSignal', async () => {
    let captured: unknown;
    const fakeSfn = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({});
      },
    } as unknown as SFNClient;
    const logger: ILogger = {
      log() {},
      beginScope: () => ({ dispose() {} }),
      logInformation() {},
      logWarning() {},
      logError() {},
      logDebug() {},
    };

    const client = new StepFunctionsClient('arn:machine', fakeSfn, logger);
    const result = await client.startExecutionAsync({ orderId: 'o1' }, 'exec-1', signal);
    expect(result.isSuccessful).toBe(true);
    expect(captured).toBe(signal);
  });

  it('Service Bus: converter copies OutboundContext.signal and the middleware passes it as abortSignal', async () => {
    const converter = new OutboundServiceBusContextConverter();
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let captured: unknown;
    const fakeSender = {
      sendMessages: (_messages: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve();
      },
    } as unknown as ServiceBusSender;

    await new ServiceBusClientMiddleware(fakeSender).handleAsync(sendContext, noNext);
    expect(captured).toBe(signal);
    expect(sendContext.isSent).toBe(true);
  });

  it('Queue Storage: converter copies OutboundContext.signal and the middleware passes it as abortSignal', async () => {
    const converter = new OutboundQueueStorageContextConverter();
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let captured: unknown;
    const fakeQueueClient = {
      sendMessage: (_text: string, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({});
      },
    } as unknown as QueueClient;

    await new QueueStorageClientMiddleware(fakeQueueClient).handleAsync(sendContext, noNext);
    expect(captured).toBe(signal);
    expect(sendContext.isSent).toBe(true);
  });

  it('Event Grid (CloudEvents and classic schema): the middleware passes the signal as abortSignal', async () => {
    const cloudEventContext = await new OutboundEventGridContextConverter('/source').createRequestAsync(
      outboundContext(signal),
    );
    expect(cloudEventContext.signal).toBe(signal);
    const classicContext = await new OutboundEventGridEventSchemaContextConverter().createRequestAsync(
      outboundContext(signal),
    );
    expect(classicContext.signal).toBe(signal);

    const capturedPerSend: unknown[] = [];
    const fakePublisher = {
      send: (_events: unknown, options?: { abortSignal?: AbortSignal }) => {
        capturedPerSend.push(options?.abortSignal);
        return Promise.resolve();
      },
    } as unknown as EventGridPublisherClient<InputSchema>;

    const middleware = new EventGridClientMiddleware(fakePublisher);
    await middleware.handleAsync(cloudEventContext, noNext);
    await middleware.handleAsync(classicContext, noNext);
    expect(capturedPerSend).toEqual([signal, signal]);
  });

  it('Event Hubs: the middleware passes the signal to both createBatch and sendBatch', async () => {
    const converter = new OutboundEventHubContextConverter();
    const sendContext = await converter.createRequestAsync(outboundContext(signal));
    expect(sendContext.signal).toBe(signal);

    let createBatchSignal: unknown;
    let sendBatchSignal: unknown;
    const fakeProducer = {
      createBatch: (options?: { abortSignal?: AbortSignal }) => {
        createBatchSignal = options?.abortSignal;
        return Promise.resolve({ tryAdd: () => true });
      },
      sendBatch: (_batch: unknown, options?: { abortSignal?: AbortSignal }) => {
        sendBatchSignal = options?.abortSignal;
        return Promise.resolve();
      },
    } as unknown as EventHubProducerClient;

    await new EventHubClientMiddleware(fakeProducer).handleAsync(sendContext, noNext);
    expect(createBatchSignal).toBe(signal);
    expect(sendBatchSignal).toBe(signal);
    expect(sendContext.isSent).toBe(true);
  });

  it('In-process: the built envelope request carries the signal for the dispatched pipeline', () => {
    const request = buildInProcessRequest(outboundContext(signal), new JsonSerializer());
    expect((request as { signal?: unknown }).signal).toBe(signal);
  });

  it('a send with no signal passes undefined through unchanged', async () => {
    const converter = new OutboundSqsContextConverter('https://queue');
    const sendContext = await converter.createRequestAsync(outboundContext(undefined));
    expect(sendContext.signal).toBeUndefined();

    let captured: unknown = 'never-set';
    const fakeSqs = {
      send: (_command: unknown, options?: { abortSignal?: AbortSignal }) => {
        captured = options?.abortSignal;
        return Promise.resolve({ $metadata: { httpStatusCode: 200 } });
      },
    } as unknown as SQSClient;

    await new SqsClientMiddleware(fakeSqs).handleAsync(sendContext, noNext);
    expect(captured).toBeUndefined();
  });
});
