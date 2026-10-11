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
import { SqsOptions } from '@benzenejs/aws-lambda-sqs';
import { SnsOptions } from '@benzenejs/aws-lambda-sns';
import { EventBridgeMessageHeadersGetter, EventBridgeOptions } from '@benzenejs/aws-lambda-eventbridge';
import { OutboundEventBridgeContextConverter } from '@benzenejs/clients-aws-eventbridge';
import { S3Options } from '@benzenejs/aws-lambda-s3';
import { DynamoDbOptions } from '@benzenejs/aws-lambda-dynamodb';
import { KinesisOptions } from '@benzenejs/aws-lambda-kinesis';
import { KafkaOptions as MskKafkaOptions } from '@benzenejs/aws-lambda-kafka';
import { BenzeneMessageLambdaOptions } from '@benzenejs/aws-lambda-core';
import { ServiceBusOptions } from '@benzenejs/azure-function-service-bus';
import { QueueStorageOptions } from '@benzenejs/azure-function-queue-storage';
import { EventGridOptions } from '@benzenejs/azure-function-event-grid';
import { KafkaOptions as FunctionsKafkaOptions } from '@benzenejs/azure-function-kafka';
import { EventHubOptions } from '@benzenejs/azure-function-event-hub';
import { TimerOptions } from '@benzenejs/azure-function-timer';
import { BlobStorageOptions } from '@benzenejs/azure-function-blob-storage';
import { CosmosDbChangeFeedOptions } from '@benzenejs/azure-function-cosmos-db';
import { BenzeneCosmosChangeFeedConfig } from '@benzenejs/azure-cosmos-db';
import { withEventHubConfigDefaults } from '@benzenejs/azure-event-hub';
import { withKafkaConfigDefaults } from '@benzenejs/kafka-core';
import { RabbitMqAckMode, withRabbitMqConfigDefaults } from '@benzenejs/rabbitmq';
import { PubSubOptions } from '@benzenejs/google-cloud-functions-pubsub';
// @benzenejs/azure-service-bus fails to load here (see the topic-key note below), so its config module is
// imported directly from source.
import { withServiceBusConfigDefaults } from '../../../src/Benzene.Azure.ServiceBus/BenzeneServiceBusConfig';
import { ServiceBusConsumerAckMode } from '../../../src/Benzene.Azure.ServiceBus/ServiceBusConsumerAckMode';

interface MetadataCase {
  name: string;
  metadata: Record<string, string>;
  expected: { topic: string; version?: string; headers?: Record<string, string>; headersExclude?: string[] };
}

type Settlement = 'redeliver' | 'skip-and-continue' | 'n/a';

interface MetadataFixture {
  defaultMetadataKeys: { topic: string; version: string; headers: string };
  metadataCases: MetadataCase[];
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

  // The version cases, through a metadata-carrying binding (the self-hosted SQS consumer: message
  // attributes are its native string->string channel). benzene-version is tier A, so they run
  // unconditionally. NOT asserted: `headersExclude` — no TypeScript binding yet drops the consumed topic
  // key from the header dictionary (a pre-existing gap the runner never exercised before spec-0.2.0; the
  // other metadataCases are not run here for the same reason, see docs/capability-matrix.md).
  describe('version metadata cases', () => {
    for (const metadataCase of fixture.metadataCases.filter((c) => c.expected.version !== undefined)) {
      it(metadataCase.name, () => {
        const container = new DefaultBenzeneServiceContainer();
        addBenzene(container);
        addSqsConsumer(container);
        addContextItems(container);
        const scope = container.createServiceResolverFactory().createScope();
        const getter = scope.getService(IMessageGetter) as unknown as IMessageGetter<SqsConsumerMessageContext>;
        const context = SqsConsumerMessageContext.createInstance({
          MessageId: 'm',
          Body: '{}',
          MessageAttributes: Object.fromEntries(
            Object.entries(metadataCase.metadata).map(([key, value]) => [key, { DataType: 'String', StringValue: value }]),
          ),
        });

        const topic = getter.getTopic(context);
        expect(topic?.id).toBe(metadataCase.expected.topic);
        expect(topic?.version ?? '').toBe(metadataCase.expected.version);
        for (const [key, value] of Object.entries(metadataCase.expected.headers ?? {})) {
          expect(getter.getHeaders(context)[key]).toBe(value);
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
