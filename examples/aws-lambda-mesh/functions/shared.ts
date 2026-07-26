/**
 * The production wiring shared by the six service Lambda entry points — the real-AWS counterpart of the
 * in-memory {@link MeshBus} the tests use. Where the bus supplies fake SDK clients and a nominal target,
 * this supplies real `@aws-sdk/client-{sqs,sns,eventbridge}` clients (region + credentials from the Lambda
 * execution role) and resolves each produced topic's transport target from the environment variable the
 * Terraform stack sets on the function (`PAYMENTS_QUEUE_URL`, `ORDER_PLACED_TOPIC_ARN`, `EVENT_BUS_NAME`, …).
 *
 * Mirrors .NET's `Shared/MeshServiceWiring.ConfigureServices`, which builds the same `AmazonSQSClient`/
 * `AmazonSimpleNotificationServiceClient`/`AmazonEventBridgeClient` and reads each `OutboundSend.TargetEnvVar`.
 * The clients are built once per cold start; the same `buildMeshServiceLambda` code runs for both the fake
 * and the real client, so only the wiring differs between test and deploy.
 */
import { SQSClient } from '@aws-sdk/client-sqs';
import { SNSClient } from '@aws-sdk/client-sns';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { OutboundWiring, MeshServiceDefinition } from '../src/meshService';

/**
 * Builds the {@link OutboundWiring} for one service from its definition: real SDK clients plus a `target`
 * that maps a produced topic to the value of the env var named in that send (`sends[].targetEnvVar`). A
 * missing env var resolves to `''` — harmless for a service that produces nothing (inventory/notifications/
 * analytics), and a fast, obvious failure for a mis-provisioned producer.
 */
export function productionOutbound(definition: MeshServiceDefinition): OutboundWiring {
  const targetEnvByTopic = new Map<string, string>();
  for (const send of definition.sends ?? []) {
    if (send.targetEnvVar !== undefined) {
      targetEnvByTopic.set(send.topic, send.targetEnvVar);
    }
  }

  return {
    sqs: new SQSClient({}),
    sns: new SNSClient({}),
    eventBridge: new EventBridgeClient({}),
    target: (topic) => {
      const envVar = targetEnvByTopic.get(topic);
      return envVar !== undefined ? (process.env[envVar] ?? '') : '';
    },
  };
}
