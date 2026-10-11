/**
 * Runs docs/specification/conformance/transport-metadata-cases.json against the TypeScript port's
 * transport bindings (wire-contracts.md section 2). Port of the .NET TransportMetadataConformanceTest
 * (Benzene.Core.Test/Conformance/TransportMetadataConformanceTest.cs).
 *
 * This is the one part of the wire contract no other fixture touches: envelope, status and
 * protocol-mapping cases never look at native metadata. A binding can rename or misspell its topic
 * key, pass every other fixture, and still be unable to exchange a single queue message with a
 * conformant peer. So every binding's reserved topic key is pinned against the fixture's
 * `defaultMetadataKeys.topic`, inbound getters and outbound converters alike (an override that reached
 * only one direction would make a service send messages it cannot itself receive).
 *
 * One documented divergence from the .NET test (see the README "Porting conventions" ledger): the port
 * has no single `BenzeneWireNames` injectable, so the ".NET defaults come from one definition" guard has
 * no analogue and each binding carries its own default constant — every one of which is pinned here.
 */
import { describe, expect, it } from 'vitest';
import { MessageVersionHeaders } from '@benzenejs/abstractions-messages';
import { SqsMessageTopicGetter } from '@benzenejs/aws-lambda-sqs';
import { SnsMessageTopicGetter } from '@benzenejs/aws-lambda-sns';
import { SqsConsumerMessageTopicGetter } from '@benzenejs/aws-sqs';
import { EventHubConsumerMessageTopicGetter } from '@benzenejs/azure-event-hub';
import { PubSubMessageTopicGetter } from '@benzenejs/google-cloud-functions-pubsub';
import { RabbitMqConstants } from '@benzenejs/rabbitmq';
import { OutboundServiceBusContextConverter } from '@benzenejs/clients-azure-service-bus';
import { OutboundEventHubContextConverter } from '@benzenejs/clients-azure-event-hub';
import { OutboundPubSubContextConverter } from '@benzenejs/clients-google-cloud-pubsub';
import { OutboundSqsContextConverter } from '@benzenejs/clients-aws-sqs';
import { OutboundSnsContextConverter } from '@benzenejs/clients-aws-sns';
import { load } from './ConformanceFixtures';
import { IMessageGetter } from '@benzenejs/abstractions-message-handlers';
import { addBenzene, addContextItems, HeaderMessageVersionGetter } from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { addSqsConsumer, SqsConsumerMessageContext } from '@benzenejs/aws-sqs';
import { addSqs, SqsMessageContext, SqsOptions } from '@benzenejs/aws-lambda-sqs';
import { addSns, SnsOptions, SnsRecordContext } from '@benzenejs/aws-lambda-sns';
import { EventBridgeMessageHeadersGetter, EventBridgeOptions } from '@benzenejs/aws-lambda-eventbridge';
import { OutboundEventBridgeContextConverter } from '@benzenejs/clients-aws-eventbridge';
import { S3Options } from '@benzenejs/aws-lambda-s3';
import { DynamoDbOptions } from '@benzenejs/aws-lambda-dynamodb';
import { KinesisOptions } from '@benzenejs/aws-lambda-kinesis';
import { addKafka as addMskKafka, KafkaContext as MskKafkaContext, KafkaOptions as MskKafkaOptions } from '@benzenejs/aws-lambda-kafka';
import { BenzeneMessageLambdaOptions } from '@benzenejs/aws-lambda-core';
import { addServiceBus, ServiceBusContext, ServiceBusOptions } from '@benzenejs/azure-function-service-bus';
import { QueueStorageOptions } from '@benzenejs/azure-function-queue-storage';
import { EventGridOptions } from '@benzenejs/azure-function-event-grid';
import {
  addKafka as addFunctionsKafka,
  KafkaContext as FunctionsKafkaContext,
  KafkaOptions as FunctionsKafkaOptions,
} from '@benzenejs/azure-function-kafka';
import { EventHubOptions } from '@benzenejs/azure-function-event-hub';
import { TimerOptions } from '@benzenejs/azure-function-timer';
import { BlobStorageOptions } from '@benzenejs/azure-function-blob-storage';
import { CosmosDbChangeFeedOptions } from '@benzenejs/azure-function-cosmos-db';
import { BenzeneCosmosChangeFeedConfig } from '@benzenejs/azure-cosmos-db';
import { addEventHubConsumer, EventHubConsumerContext, withEventHubConfigDefaults } from '@benzenejs/azure-event-hub';
import { addKafkaConsumer, KafkaRecordContext, withKafkaConfigDefaults } from '@benzenejs/kafka-core';
import { addRabbitMqConsumer, RabbitMqAckMode, RabbitMqContext, withRabbitMqConfigDefaults } from '@benzenejs/rabbitmq';
import {
  addGooglePubSub,
  MessagePublishedData,
  PubSubContext,
  PubSubOptions,
} from '@benzenejs/google-cloud-functions-pubsub';
import { Constants } from '@benzenejs/core-messages';
import type { MSKEvent, MSKRecord, SNSEventRecord, SQSRecord } from 'aws-lambda';
import type { EachMessagePayload } from 'kafkajs';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import type { ConsumeMessage } from 'amqplib';
// @benzenejs/azure-service-bus fails to load here (see the topic-key note below), so its config module is
// imported directly from source.
import { withServiceBusConfigDefaults } from '../../../src/Benzene.Azure.ServiceBus/BenzeneServiceBusConfig';
import { ServiceBusConsumerAckMode } from '../../../src/Benzene.Azure.ServiceBus/ServiceBusConsumerAckMode';
import { addServiceBusConsumer } from '../../../src/Benzene.Azure.ServiceBus/DependencyInjectionExtensions';
import { ServiceBusConsumerContext } from '../../../src/Benzene.Azure.ServiceBus/ServiceBusConsumerContext';

interface MetadataExpectation {
  topic: string;
  version?: string;
  headers?: Record<string, string>;
  headersExclude?: string[];
}

interface MetadataCase {
  name: string;
  metadata: Record<string, string>;
  expected: MetadataExpectation;
}

interface OverrideCase extends MetadataCase {
  metadataKeys: { topic: string };
}

type Settlement = 'redeliver' | 'skip-and-continue' | 'n/a';

interface MetadataFixture {
  defaultMetadataKeys: { topic: string; version: string; headers: string };
  topicSources: { binding: string; source: string; fallback?: string }[];
  metadataCases: MetadataCase[];
  overrideCases: OverrideCase[];
  settlementDefaults: {
    shapes: Record<string, { onFailure: Settlement[]; unmatchedTopic: Settlement[] }>;
    bindings: { binding: string; shape: string }[];
  };
}

const fixture = load<MetadataFixture>('transport-metadata-cases.json');
const expectedTopicKey = fixture.defaultMetadataKeys.topic;
const expectedVersionKey = fixture.defaultMetadataKeys.version;

// Every binding that exposes its default topic key as a constant and loads without an (uninstalled)
// cloud health-check package. The inbound Azure Service Bus getter (@benzenejs/azure-service-bus) is
// omitted: its package fails to load here because it re-exports the not-yet-published
// @benzenejs/health-checks-azure-service-bus (a pre-existing gap, unrelated to the topic key). Its
// outbound converter is covered below.
const conformantTopicKeys: [string, string][] = [
  ['sqs (inbound, lambda)', SqsMessageTopicGetter.DefaultTopicAttribute],
  ['sns (inbound, lambda)', SnsMessageTopicGetter.DefaultTopicAttribute],
  ['sqs (inbound, consumer)', SqsConsumerMessageTopicGetter.DefaultTopicAttribute],
  ['eventhub (inbound)', EventHubConsumerMessageTopicGetter.DefaultTopicProperty],
  ['pubsub (inbound)', PubSubMessageTopicGetter.DefaultTopicAttribute],
  ['rabbitmq (inbound)', RabbitMqConstants.DefaultTopicHeader],
  ['servicebus (outbound, raw)', OutboundServiceBusContextConverter.DefaultTopicProperty],
  ['eventhub (outbound, raw)', OutboundEventHubContextConverter.DefaultTopicProperty],
  ['pubsub (outbound, raw)', OutboundPubSubContextConverter.DefaultTopicAttribute],
  ['sqs (outbound, raw)', OutboundSqsContextConverter.DefaultTopicAttribute],
  ['sns (outbound, raw)', OutboundSnsContextConverter.DefaultTopicAttribute],
];

describe('TransportMetadataConformanceTest', () => {
  describe('every binding uses the spec default topic key', () => {
    for (const [binding, actualKey] of conformantTopicKeys) {
      it(binding, () => {
        expect(actualKey).toBe(expectedTopicKey);
      });
    }
  });

  it('carries the payload version under the spec default version key', () => {
    expect(MessageVersionHeaders.default).toBe(expectedVersionKey);
    expect(HeaderMessageVersionGetter.defaultHeaderName).toBe(expectedVersionKey);
  });

  it('embeds EventBridge wire headers under the spec default headers key (benzene-headers)', () => {
    expect(EventBridgeMessageHeadersGetter.EmbeddedHeadersKey).toBe(fixture.defaultMetadataKeys.headers);
    expect(OutboundEventBridgeContextConverter.EmbeddedHeadersKey).toBe(fixture.defaultMetadataKeys.headers);
  });

  // metadataCases and overrideCases, through every binding whose topic comes from native metadata
  // (topicSources `source: "metadata"`): each case's neutral dictionary is written into the binding's own
  // native channel, the binding is registered through its real DI function (with the case's topic key on
  // an override), and the topic, version and headers are read back through the container's IMessageGetter
  // - the same path the router reads them on. benzene-version is tier A, so every case runs unconditionally.
  describe('metadataCases', () => {
    for (const binding of metadataBindings) {
      describe(binding.name, () => {
        for (const metadataCase of fixture.metadataCases) {
          it(metadataCase.name, () => {
            assertResolution(binding, expectedTopicKey, metadataCase.metadata, metadataCase.expected);
          });
        }
      });
    }
  });

  // topicSources: a metadata binding with a `fallback` routes on it when the topic key is absent, and the
  // key, when present, always wins (conformance/README.md). The fixture's fallback is prose, so the native
  // value is this runner's: a routing key / Kafka topic of 'native:fallback'.
  describe('topicSources fallback', () => {
    const fallbacks = new Map(
      fixture.topicSources.filter((source) => source.fallback !== undefined).map((source) => [source.binding, source.fallback]),
    );

    it('names a fallback for exactly the bindings this runner exercises one for', () => {
      const exercised = new Set(metadataBindings.flatMap((binding) => (binding.fallbackBinding === undefined ? [] : [binding.fallbackBinding])));
      expect([...fallbacks.keys()].sort()).toEqual([...exercised].sort());
    });

    for (const binding of metadataBindings.filter((b) => b.fallbackBinding !== undefined)) {
      it(`${binding.name}: the key wins; absent, the ${binding.fallbackBinding} fallback routes`, () => {
        assertResolution(binding, expectedTopicKey, { topic: 'conformance:greet' }, { topic: 'conformance:greet', headersExclude: ['topic'] }, 'native:fallback');
        assertResolution(binding, expectedTopicKey, { 'x-correlation-id': 'abc-123' }, { topic: 'native:fallback', headers: { 'x-correlation-id': 'abc-123' } }, 'native:fallback');
      });
    }
  });

  describe('overrideCases', () => {
    for (const binding of metadataBindings) {
      describe(binding.name, () => {
        for (const overrideCase of fixture.overrideCases) {
          it(overrideCase.name, () => {
            assertResolution(binding, overrideCase.metadataKeys.topic, overrideCase.metadata, overrideCase.expected);
          });
        }
      });
    }
  });

  // settlementDefaults (transport-bindings §1, obligation 8): each one-way binding this port ships, its
  // fixture id, and its default settlement read from the binding's own options/config defaults.
  describe('settlementDefaults', () => {
    const shipped: { binding: string; port: string; shape: string; onFailure: Settlement; unmatchedTopic: Settlement }[] = [
      queue('sqs', 'Lambda SQS (@benzenejs/aws-lambda-sqs)', !new SqsOptions().atMostOnce, new SqsOptions().ignoreUnmatchedTopics),
      queue('sqs', 'self-hosted SQS consumer (@benzenejs/aws-sqs)', true, false),
      queue(
        'servicebus',
        'Functions Service Bus trigger',
        new ServiceBusOptions().raiseOnFailureStatus && !new ServiceBusOptions().atMostOnce,
        new ServiceBusOptions().ignoreUnmatchedTopics,
      ),
      queue(
        'servicebus',
        'self-hosted Service Bus worker',
        withServiceBusConfigDefaults({}).ackMode === ServiceBusConsumerAckMode.Explicit,
        withServiceBusConfigDefaults({}).ignoreUnmatchedTopics === true,
      ),
      queue(
        'queue-storage',
        'Functions Queue Storage trigger',
        new QueueStorageOptions().raiseOnFailureStatus,
        new QueueStorageOptions().ignoreUnmatchedTopics,
      ),
      queue('pubsub', 'Cloud Functions Pub/Sub', new PubSubOptions().raiseOnFailureStatus, new PubSubOptions().ignoreUnmatchedTopics),
      queue('rabbitmq', 'RabbitMQ worker', withRabbitMqConfigDefaults({ queueName: 'q' }).ackMode === RabbitMqAckMode.Explicit, false),
      oneShot('sns', 'Lambda SNS', new SnsOptions().raiseOnFailureStatus, new SnsOptions().ignoreUnmatchedTopics),
      oneShot('eventbridge', 'Lambda EventBridge', new EventBridgeOptions().raiseOnFailureStatus, new EventBridgeOptions().ignoreUnmatchedTopics),
      oneShot('s3', 'Lambda S3', new S3Options().raiseOnFailureStatus, new S3Options().ignoreUnmatchedTopics),
      oneShot('event-grid', 'Functions Event Grid trigger', new EventGridOptions().raiseOnFailureStatus, new EventGridOptions().ignoreUnmatchedTopics),
      oneShot('envelope-async', "Lambda envelope, invocationType 'Event'", !new BenzeneMessageLambdaOptions().atMostOnce, new BenzeneMessageLambdaOptions().ignoreUnmatchedTopics),
      oneShot('blob-storage', 'Functions Blob trigger (errors only; no routing)', !new BlobStorageOptions().atMostOnce, false),
      oneShot('timer', 'Functions Timer trigger', new TimerOptions().raiseOnFailureStatus, new TimerOptions().ignoreUnmatchedTopics),
      stream('kafka', 'Lambda MSK', !new MskKafkaOptions().atMostOnce, new MskKafkaOptions().ignoreUnmatchedTopics),
      stream('kafka', 'Functions Kafka trigger', new FunctionsKafkaOptions().raiseOnFailureStatus, new FunctionsKafkaOptions().ignoreUnmatchedTopics),
      // The self-hosted stream workers skip-and-continue by default (documented on their configs).
      stream('kafka', 'self-hosted Kafka worker', withKafkaConfigDefaults({ topics: [] }).commitOnlyOnSuccess, withKafkaConfigDefaults({ topics: [] }).ignoreUnmatchedTopics),
      stream('eventhub', 'Functions Event Hub trigger', new EventHubOptions().raiseOnFailureStatus, new EventHubOptions().ignoreUnmatchedTopics),
      stream('eventhub', 'self-hosted Event Hub worker', !withEventHubConfigDefaults({}).catchHandlerExceptions, withEventHubConfigDefaults({}).ignoreUnmatchedTopics),
      stream('kinesis', 'Lambda Kinesis', new KinesisOptions().raiseOnFailureStatus, new KinesisOptions().ignoreUnmatchedTopics),
      stream('dynamodb-streams', 'Lambda DynamoDB Streams', !new DynamoDbOptions().atMostOnce, new DynamoDbOptions().ignoreUnmatchedTopics),
      stream('cosmosdb-changefeed', 'Functions Cosmos DB trigger (fan-in)', !new CosmosDbChangeFeedOptions().atMostOnce, false),
      stream('cosmosdb-changefeed', 'self-hosted Cosmos DB change feed (fan-in)', !new BenzeneCosmosChangeFeedConfig().catchHandlerExceptions, false),
      requestResponse('http', 'Express / API Gateway / Functions HTTP / Cloud Functions HTTP'),
      requestResponse('grpc', 'gRPC'),
      requestResponse('envelope', "Lambda envelope ('RequestResponse'), /benzene/invoke"),
    ];

    const fixtureShapes = new Map(fixture.settlementDefaults.bindings.map((b) => [b.binding, b.shape]));

    for (const binding of shipped) {
      it(`${binding.port} is '${binding.binding}' (${binding.shape}) and defaults to an allowed settlement`, () => {
        expect(fixtureShapes.get(binding.binding), `fixture names no binding '${binding.binding}'`).toBe(binding.shape);
        const allowed = fixture.settlementDefaults.shapes[binding.shape]!;
        expect(allowed.onFailure).toContain(binding.onFailure);
        expect(allowed.unmatchedTopic).toContain(binding.unmatchedTopic);
      });
    }
  });
});

/**
 * A native-metadata inbound binding under test: registers itself (with the given topic key) on a
 * container, and builds its native context from the fixture's neutral string->string dictionary.
 */
interface MetadataBinding {
  name: string;
  /** The topicSources binding whose `fallback` this binding routes on when the topic key is absent. */
  fallbackBinding?: string;
  register: (container: DefaultBenzeneServiceContainer, topicKey: string) => void;
  /** `fallback`: the native routing value a `fallbackBinding` falls back to (empty when not given). */
  context: (metadata: Record<string, string>, fallback?: string) => unknown;
}

const metadataBindings: MetadataBinding[] = [
  {
    name: 'sqs (lambda): message attributes',
    register: (container, topicKey) => addSqs(container, topicKey),
    context: (metadata) =>
      SqsMessageContext.createInstance({ Records: [] }, {
        messageId: 'm',
        body: '{}',
        messageAttributes: mapValues(metadata, (value) => ({ dataType: 'String', stringValue: value })),
      } as unknown as SQSRecord),
  },
  {
    name: 'sns (lambda): message attributes',
    register: (container, topicKey) => addSns(container, topicKey),
    context: (metadata) =>
      SnsRecordContext.createInstance({ Records: [] }, {
        Sns: { Message: '{}', MessageAttributes: mapValues(metadata, (value) => ({ Type: 'String', Value: value })) },
      } as unknown as SNSEventRecord),
  },
  {
    name: 'sqs (self-hosted consumer): message attributes',
    register: (container, topicKey) => addSqsConsumer(container, topicKey),
    context: (metadata) =>
      SqsConsumerMessageContext.createInstance({
        MessageId: 'm',
        Body: '{}',
        MessageAttributes: mapValues(metadata, (value) => ({ DataType: 'String', StringValue: value })),
      }),
  },
  {
    name: 'pubsub: attributes',
    register: (container, topicKey) => addGooglePubSub(container, topicKey),
    context: (metadata) => new PubSubContext({ message: { data: '', attributes: { ...metadata } } } as unknown as MessagePublishedData),
  },
  {
    name: 'servicebus (functions trigger): application properties',
    register: (container, topicKey) => addServiceBus(container, topicKey),
    context: (metadata) => new ServiceBusContext({ body: {}, applicationProperties: { ...metadata } } as unknown as ServiceBusReceivedMessage),
  },
  {
    name: 'servicebus (self-hosted consumer): application properties',
    register: (container, topicKey) => addServiceBusConsumer(container, topicKey),
    context: (metadata) =>
      ServiceBusConsumerContext.createInstance({ body: {}, applicationProperties: { ...metadata } } as unknown as ServiceBusReceivedMessage),
  },
  {
    name: 'eventhub (self-hosted consumer): application properties',
    register: (container, topicKey) => addEventHubConsumer(container, topicKey),
    context: (metadata) => EventHubConsumerContext.createInstance({ body: {}, properties: { ...metadata } } as unknown as ReceivedEventData),
  },
  {
    // No routing key: the AMQP routing-key fallback (topicSources) is for a non-Benzene producer and
    // would otherwise stand in for an absent topic header.
    name: 'rabbitmq: BasicProperties.Headers',
    fallbackBinding: 'rabbitmq',
    register: (container, topicKey) => addRabbitMqConsumer(container, topicKey),
    context: (metadata, fallback = '') =>
      RabbitMqContext.createInstance({
        content: Buffer.from('{}'),
        fields: { routingKey: fallback },
        // RabbitMQ carries header values as byte[]: deliver them that way.
        properties: { headers: mapValues(metadata, (value) => Buffer.from(value)) },
      } as unknown as ConsumeMessage),
  },
  // Kafka (topicSources: metadata, falling back to the Kafka topic the record was consumed from - spec
  // ruling Benzene 0b53dddb). As for RabbitMQ, the cases run with an empty Kafka topic so the fallback
  // cannot stand in for an absent topic header; the fallback has its own assertion below.
  {
    name: 'kafka (self-hosted consumer): headers',
    fallbackBinding: 'kafka',
    register: (container, topicKey) => addKafkaConsumer(container, topicKey),
    context: (metadata, fallback = '') =>
      KafkaRecordContext.createInstance({
        topic: fallback,
        partition: 0,
        message: { key: null, value: Buffer.from('{}'), offset: '1', headers: mapValues(metadata, (value) => Buffer.from(value)) },
      } as unknown as EachMessagePayload),
  },
  {
    name: 'kafka (lambda msk): headers',
    fallbackBinding: 'kafka',
    register: (container, topicKey) => addMskKafka(container, topicKey),
    context: (metadata, fallback = '') =>
      new MskKafkaContext({ eventSource: 'aws:kafka', records: {} } as unknown as MSKEvent, {
        topic: fallback,
        partition: 0,
        offset: 1,
        value: '',
        // MSK delivers Kafka's header list as one { key: bytes } object per header.
        headers: Object.entries(metadata).map(([key, value]) => ({ [key]: Array.from(Buffer.from(value)) })),
      } as unknown as MSKRecord),
  },
  {
    name: 'kafka (functions trigger): headers',
    fallbackBinding: 'kafka',
    register: (container, topicKey) => addFunctionsKafka(container, topicKey),
    context: (metadata, fallback = '') =>
      new FunctionsKafkaContext({ topic: fallback, headers: mapValues(metadata, (value) => new TextEncoder().encode(value)) }),
  },
];

/**
 * Registers `binding` with `topicKey`, then reads the case's topic, version and headers back through the
 * container's IMessageGetter. An unresolved topic is the port's `<missing>` id (`Constants.missing`), which
 * the fixture spells `""`.
 */
function assertResolution(
  binding: MetadataBinding,
  topicKey: string,
  metadata: Record<string, string>,
  expected: MetadataExpectation,
  fallback?: string,
): void {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  binding.register(container, topicKey);
  addContextItems(container);
  const scope = container.createServiceResolverFactory().createScope();
  const getter = scope.getService(IMessageGetter) as unknown as IMessageGetter<unknown>;
  const context = binding.context(metadata, fallback);

  const topic = getter.getTopic(context);
  const topicId = topic === undefined || topic.id === Constants.missing.id ? '' : topic.id;
  expect(topicId, 'topic').toBe(expected.topic);
  expect(topic?.version ?? '', 'version').toBe(expected.version ?? '');
  const headers = getter.getHeaders(context);
  for (const [key, value] of Object.entries(expected.headers ?? {})) {
    expect(headers[key], `headers['${key}']`).toBe(value);
  }
  for (const key of expected.headersExclude ?? []) {
    expect(Object.keys(headers).map((k) => k.toLowerCase()), `headers must not carry the consumed '${key}'`).not.toContain(
      key.toLowerCase(),
    );
  }
}

function mapValues<T>(record: Record<string, string>, map: (value: string) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]));
}

function queue(binding: string, port: string, redeliversFailure: boolean, ignoresUnmatched: boolean) {
  return settle(binding, port, 'queue', redeliversFailure, ignoresUnmatched);
}
function oneShot(binding: string, port: string, redeliversFailure: boolean, ignoresUnmatched: boolean) {
  return settle(binding, port, 'one-shot', redeliversFailure, ignoresUnmatched);
}
function stream(binding: string, port: string, redeliversFailure: boolean, ignoresUnmatched: boolean) {
  return settle(binding, port, 'stream', redeliversFailure, ignoresUnmatched);
}
function requestResponse(binding: string, port: string) {
  return { binding, port, shape: 'request-response', onFailure: 'n/a' as Settlement, unmatchedTopic: 'n/a' as Settlement };
}
function settle(binding: string, port: string, shape: string, redeliversFailure: boolean, ignoresUnmatched: boolean) {
  const onFailure: Settlement = redeliversFailure ? 'redeliver' : 'skip-and-continue';
  const unmatchedTopic: Settlement = ignoresUnmatched ? 'skip-and-continue' : onFailure;
  return { binding, port, shape, onFailure, unmatchedTopic };
}
