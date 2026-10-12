import { describe, expect, it } from 'vitest';
import type { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import type { SFNClient } from '@aws-sdk/client-sfn';
import type { SNSClient } from '@aws-sdk/client-sns';
import type { SQSClient } from '@aws-sdk/client-sqs';
import type { EventGridPublisherClient, InputSchema } from '@azure/eventgrid';
import type { EventHubProducerClient } from '@azure/event-hubs';
import type { ServiceBusSender } from '@azure/service-bus';
import type { QueueClient } from '@azure/storage-queue';
import type { PubSub } from '@google-cloud/pubsub';
import type { Channel } from 'amqplib';
import type { Producer } from 'kafkajs';
import { IBenzeneResult, ILogger } from '@benzenejs/abstractions';
import { addOutboundRouting, IBenzeneMessageSender, OutboundRoutingBuilder, sendMessageAsync } from '@benzenejs/clients';
import { useEventBridge } from '@benzenejs/clients-aws-eventbridge';
import { useSns } from '@benzenejs/clients-aws-sns';
import { useSqs } from '@benzenejs/clients-aws-sqs';
import { StepFunctionsClient } from '@benzenejs/clients-aws-step-functions';
import { useEventGrid, useEventGridEventSchema } from '@benzenejs/clients-azure-event-grid';
import { useEventHub } from '@benzenejs/clients-azure-event-hub';
import { useQueueStorage } from '@benzenejs/clients-azure-queue-storage';
import { useServiceBus } from '@benzenejs/clients-azure-service-bus';
import { usePubSub } from '@benzenejs/clients-google-cloud-pubsub';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { KafkaBenzeneMessageClient } from '@benzenejs/kafka-core';
import { RabbitMqBenzeneMessageClient } from '@benzenejs/rabbitmq';
import { BenzeneResultStatus, failedSendResult } from '@benzenejs/results';

/**
 * transport-bindings.md §1 (spec 1.1): a one-way send that fails before the broker accepts the message
 * yields a result, not an exception - `timeout` when the deadline elapsed, otherwise `service-unavailable`.
 * Every one-way client the port ships is driven over a fake SDK client whose send rejects; the send must
 * resolve to that failed result. A rejection the broker itself answered (an AWS service exception, an Azure
 * RestError) maps its HTTP status through the reverse table instead.
 */

/** A refused connection, as Node reports one. */
const refused = (): Error => Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), { code: 'ECONNREFUSED' });

function senderFor(configure: (routing: OutboundRoutingBuilder) => void): IBenzeneMessageSender {
  const container = new DefaultBenzeneServiceContainer();
  addOutboundRouting(container, configure);
  return container.createServiceResolverFactory().createScope().getService(IBenzeneMessageSender);
}

/** Sends one message on a route built by `route`, over an SDK call that rejects with `error()`. */
type RoutedClient = (error: () => unknown) => (routing: OutboundRoutingBuilder) => void;

const rejectingSend = (error: () => unknown) => ({ send: () => Promise.reject(error()) });

const routedClients: [string, RoutedClient][] = [
  ['SQS', (e) => (r) => r.route('t', (p) => useSqs(p, 'https://sqs/q', rejectingSend(e) as unknown as SQSClient))],
  ['SNS', (e) => (r) => r.route('t', (p) => useSns(p, 'arn:aws:sns:eu-west-1:0:t', rejectingSend(e) as unknown as SNSClient))],
  ['EventBridge', (e) => (r) => r.route('t', (p) => useEventBridge(p, 'src', rejectingSend(e) as unknown as EventBridgeClient, 'bus'))],
  ['Event Grid (CloudEvents)', (e) => (r) => r.route('t', (p) => useEventGrid(p, rejectingSend(e) as unknown as EventGridPublisherClient<InputSchema>, 'src'))],
  ['Event Grid (Event Grid schema)', (e) => (r) => r.route('t', (p) => useEventGridEventSchema(p, rejectingSend(e) as unknown as EventGridPublisherClient<InputSchema>))],
  ['Event Hub (createBatch)', (e) => (r) => r.route('t', (p) => useEventHub(p, { createBatch: () => Promise.reject(e()) } as unknown as EventHubProducerClient))],
  [
    'Event Hub (sendBatch)',
    (e) => (r) =>
      r.route('t', (p) =>
        useEventHub(p, { createBatch: () => Promise.resolve({ tryAdd: () => true }), sendBatch: () => Promise.reject(e()) } as unknown as EventHubProducerClient),
      ),
  ],
  ['Queue Storage', (e) => (r) => r.route('t', (p) => useQueueStorage(p, { sendMessage: () => Promise.reject(e()) } as unknown as QueueClient))],
  ['Service Bus', (e) => (r) => r.route('t', (p) => useServiceBus(p, { sendMessages: () => Promise.reject(e()) } as unknown as ServiceBusSender))],
  ['Pub/Sub', (e) => (r) => r.route('t', (p) => usePubSub(p, { topic: () => ({ publishMessage: () => Promise.reject(e()) }) } as unknown as PubSub, 'topic'))],
];

describe('one-way clients: a send that fails before the broker accepts it', () => {
  describe.each(routedClients)('%s', (_name, client) => {
    it('a refused connection is service-unavailable, carrying the error, not an exception', async () => {
      const result = await senderFor(client(refused)).sendAsync('t', { id: 1 });
      expect(result.isSuccessful).toBe(false);
      expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
      expect(result.errors).toEqual([{ message: 'connect ECONNREFUSED 10.0.0.1:443' }]);
    });

    it('a timed-out send is timeout', async () => {
      const timedOut = (): Error => Object.assign(new Error('Connection timed out after 1000 ms'), { name: 'TimeoutError' });
      const result = await senderFor(client(timedOut)).sendAsync('t', { id: 1 });
      expect(result.status).toBe(BenzeneResultStatus.timeout);
    });
  });

  it("a rejection the broker answered maps its HTTP status (an AWS service exception's $metadata)", async () => {
    const accessDenied = (): Error =>
      Object.assign(new Error('Access to the resource is denied.'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
    const result = await senderFor(routedClients[0]![1](accessDenied)).sendAsync('t', {});
    expect(result.status).toBe(BenzeneResultStatus.forbidden);
    expect(result.errors).toEqual([{ message: 'Access to the resource is denied.' }]);
  });

  it("a rejection the broker answered maps its HTTP status (an Azure RestError's statusCode)", async () => {
    const throttled = (): Error => Object.assign(new Error('Too many requests'), { name: 'RestError', statusCode: 429 });
    const result = await senderFor(routedClients[7]![1](throttled)).sendAsync('t', {});
    expect(result.status).toBe(BenzeneResultStatus.tooManyRequests);
  });

  it('an event too large for an Event Hubs batch is not a transport failure, and still throws', async () => {
    const producer = { createBatch: () => Promise.resolve({ tryAdd: () => false }), sendBatch: () => Promise.resolve() } as unknown as EventHubProducerClient;
    await expect(senderFor((r) => r.route('t', (p) => useEventHub(p, producer))).sendAsync('t', {})).rejects.toThrow(/too large/);
  });

  describe('message clients (Kafka, RabbitMQ) and Step Functions', () => {
    const noopLogger = { logError: () => undefined } as unknown as ILogger;
    const kafkaTimeout = (): Error => Object.assign(new Error('Request Produce(key: 0) timed out'), { name: 'KafkaJSRequestTimeoutError' });

    it('Kafka: a refused broker is service-unavailable, a request timeout is timeout', async () => {
      const kafka = (error: () => Error): Promise<IBenzeneResult> =>
        sendMessageAsync(new KafkaBenzeneMessageClient({ send: () => Promise.reject(error()) } as unknown as Producer), 't', {});
      expect((await kafka(refused)).status).toBe(BenzeneResultStatus.serviceUnavailable);
      expect((await kafka(kafkaTimeout)).status).toBe(BenzeneResultStatus.timeout);
    });

    it('RabbitMQ: a closed channel is service-unavailable', async () => {
      const channel = {
        publish: () => {
          throw Object.assign(new Error('Channel closed'), { name: 'IllegalOperationError' });
        },
      } as unknown as Channel;
      const result = await sendMessageAsync(new RabbitMqBenzeneMessageClient(channel), 't', {});
      expect(result.status).toBe(BenzeneResultStatus.serviceUnavailable);
      expect(result.errors).toEqual([{ message: 'Channel closed' }]);
    });

    it('Step Functions: unreachable is service-unavailable, timed out is timeout, a throttle is too-many-requests', async () => {
      const start = (error: () => unknown): Promise<IBenzeneResult> =>
        new StepFunctionsClient('arn:sm', rejectingSend(error) as unknown as SFNClient, noopLogger).startExecutionAsync({});
      expect((await start(refused)).status).toBe(BenzeneResultStatus.serviceUnavailable);
      expect((await start(() => Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).status).toBe(BenzeneResultStatus.timeout);
      expect((await start(() => Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException', $metadata: { httpStatusCode: 429 } }))).status).toBe(
        BenzeneResultStatus.tooManyRequests,
      );
    });
  });
});

describe('failedSendResult', () => {
  it.each([
    ['an Azure messaging ServiceTimeout', Object.assign(new Error('timed out'), { code: 'ServiceTimeout' }), BenzeneResultStatus.timeout],
    ['a gRPC DEADLINE_EXCEEDED (Pub/Sub)', Object.assign(new Error('4 DEADLINE_EXCEEDED'), { code: 4, details: 'Deadline exceeded' }), BenzeneResultStatus.timeout],
    ['a gRPC UNAVAILABLE (Pub/Sub)', Object.assign(new Error('14 UNAVAILABLE'), { code: 14, details: 'No connection' }), BenzeneResultStatus.serviceUnavailable],
    ['an AWS 5xx after retries', Object.assign(new Error('Service Unavailable'), { $metadata: { httpStatusCode: 503 } }), BenzeneResultStatus.serviceUnavailable],
    ['an AWS network error (no httpStatusCode)', Object.assign(refused(), { $metadata: { attempts: 3 } }), BenzeneResultStatus.serviceUnavailable],
  ])('%s', (_name, error, expected) => {
    expect(failedSendResult(error).status).toBe(expected);
  });
});
