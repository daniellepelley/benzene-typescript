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

interface MetadataFixture {
  defaultMetadataKeys: { topic: string; version: string };
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
  });
});
