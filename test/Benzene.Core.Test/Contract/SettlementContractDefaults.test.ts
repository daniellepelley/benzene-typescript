/**
 * Port of test/Benzene.Core.Test/Contract/SettlementContractDefaultsTest.cs (benzene-dotnet).
 *
 * Guards the 1.0 settlement contract against silent drift between the code and
 * docs/capability-matrix.md. The contract is NOT uniform — and the guard encodes that:
 *
 *  - Queue-shaped transports are safe-by-default: a returned failure result is redelivered
 *    (at-least-once), not silently settled. `queue-shaped transports default to safe` pins each
 *    one's CODE default; the capability-matrix tests pin its documented row.
 *  - The two self-hosted STREAM workers (Kafka.Core, Azure.EventHub) default to AT-MOST-ONCE: a
 *    stream has no per-message ack, so "don't lose a failed record" would mean halting the whole
 *    worker — too drastic to be a default.
 *
 * A THIRD, SEPARATE AXIS is guarded below: the NULL/UNROUTED outcome (no messageResult recorded —
 * overwhelmingly an unrouted message: no handler matched the topic), which is independent of the
 * failure-result axis and is governed by benzene-dotnet's work/settlement-consistency-fix-plan.md
 * §1 (the table this port applies). `null-outcome policy` pins the polarity of every adapter's
 * enforcement point in source — positive assertions for the Kafka/Event Hub carve-outs included:
 * it must fail if one of those is ever "fixed" to retain-on-null. Read that document before
 * touching any of these lines or the code they assert against.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SnsOptions } from '@benzenejs/aws-lambda-sns';
import { S3Options } from '@benzenejs/aws-lambda-s3';
import { EventBridgeOptions } from '@benzenejs/aws-lambda-eventbridge';
import {
  KafkaBatchFailureMode as AwsKafkaBatchFailureMode,
  KafkaOptions as AwsKafkaOptions,
} from '@benzenejs/aws-lambda-kafka';
import { SqsBatchFailureMode, SqsOptions } from '@benzenejs/aws-lambda-sqs';
import { ServiceBusOptions } from '@benzenejs/azure-function-service-bus';
import { KafkaOptions as AzureKafkaOptions } from '@benzenejs/azure-function-kafka';
import { QueueStorageOptions } from '@benzenejs/azure-function-queue-storage';
import { EventGridOptions } from '@benzenejs/azure-function-event-grid';
import { EventHubOptions } from '@benzenejs/azure-function-event-hub';
import { PubSubOptions } from '@benzenejs/google-cloud-functions-pubsub';
import { RabbitMqAckMode, withRabbitMqConfigDefaults } from '@benzenejs/rabbitmq';
import { ServiceBusConsumerAckMode, withServiceBusConfigDefaults } from '@benzenejs/azure-service-bus';
import { withKafkaConfigDefaults } from '@benzenejs/kafka-core';
import { withEventHubConfigDefaults } from '@benzenejs/azure-event-hub';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

function readRepoFile(repoRelativePath: string): string {
  return readFileSync(`${repoRoot}/${repoRelativePath}`, 'utf8');
}

/** The "Returned-failure-result settlement" section of docs/capability-matrix.md. */
function settlementSection(): string {
  const matrix = readRepoFile('docs/capability-matrix.md');
  const start = matrix.indexOf('## Returned-failure-result settlement');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = matrix.indexOf('\n## ', start);
  return end === -1 ? matrix.slice(start) : matrix.slice(start, end);
}

/**
 * Finds the single settlement-section table row mentioning the backtick-wrapped package path —
 * matching on the backticked token so a shorter path can't match a longer one's row (e.g.
 * src/Benzene.Azure.EventHub vs src/Benzene.Azure.Function.EventHub).
 */
function matrixRow(packagePath: string): string {
  const token = `\`${packagePath}\``;
  const rows = settlementSection()
    .split('\n')
    .filter((line) => line.trimStart().startsWith('|') && line.includes(token));
  expect(
    rows,
    `Expected exactly one settlement-breakdown row mentioning ${token} in docs/capability-matrix.md ` +
      `(see benzene-dotnet's work/settlement-consistency-fix-plan.md)`,
  ).toHaveLength(1);
  return rows[0];
}

describe('SettlementContractDefaults', () => {
  it('queue-shaped transports default to safe (a returned failure result is redelivered)', () => {
    // AWS Lambda event sources — a returned failure escalates (raiseOnFailureStatus) ...
    expect(new SnsOptions().raiseOnFailureStatus).toBe(true);
    expect(new S3Options().raiseOnFailureStatus).toBe(true);
    expect(new EventBridgeOptions().raiseOnFailureStatus).toBe(true);
    // ... or is reported for redelivery per-message/per-partition rather than the batch swallowed.
    expect(new SqsOptions().batchFailureMode).toBe(SqsBatchFailureMode.PartialBatchFailure);
    expect(new AwsKafkaOptions().batchFailureMode).toBe(AwsKafkaBatchFailureMode.PartialBatchFailure);

    // Azure Functions triggers.
    expect(new ServiceBusOptions().raiseOnFailureStatus).toBe(true);
    expect(new AzureKafkaOptions().raiseOnFailureStatus).toBe(true);
    expect(new QueueStorageOptions().raiseOnFailureStatus).toBe(true);
    expect(new EventGridOptions().raiseOnFailureStatus).toBe(true);
    expect(new EventHubOptions().raiseOnFailureStatus).toBe(true);

    // Azure self-hosted Service Bus worker (a queue — per-message abandon).
    expect(withServiceBusConfigDefaults({ queueName: 'guard' }).ackMode).toBe(
      ServiceBusConsumerAckMode.Explicit,
    );

    // RabbitMQ self-hosted worker.
    expect(withRabbitMqConfigDefaults({ queueName: 'guard' }).ackMode).toBe(RabbitMqAckMode.Explicit);

    // Google Cloud Pub/Sub.
    expect(new PubSubOptions().raiseOnFailureStatus).toBe(true);
  });

  it('the two self-hosted stream workers default to at-most-once', () => {
    // A stream has no per-message ack/abandon, so safe-by-default would mean halting the worker
    // (never advancing the offset/checkpoint past a poison record) — too drastic to be a default.
    // Both therefore default to skip-and-continue (at-most-once); at-least-once is opt-in.

    // Event Hub worker: raiseOnFailureStatus=true escalates a failure result into an exception, but
    // catchHandlerExceptions=true (this default) then catches it and the partition advances — so the
    // failed event is skipped once a later one checkpoints. At-least-once needs
    // catchHandlerExceptions=false. Guarding catchHandlerExceptions here is what pins the
    // DOCUMENTED at-most-once default (raiseOnFailureStatus alone doesn't achieve safety).
    const eventHub = withEventHubConfigDefaults({});
    expect(eventHub.catchHandlerExceptions).toBe(true);
    expect(eventHub.raiseOnFailureStatus).toBe(true); // true, but defeated by catchHandlerExceptions

    // Kafka worker: offsets auto-commit regardless of outcome unless commitOnlyOnSuccess is set, so
    // a failed record is skipped. At-least-once needs commitOnlyOnSuccess=true; raiseOnFailureStatus
    // (default true) then settles a RETURNED failure result like a throw (.NET e967122).
    const kafka = withKafkaConfigDefaults({ topics: ['guard'] });
    expect(kafka.commitOnlyOnSuccess).toBe(false);
    expect(kafka.raiseOnFailureStatus).toBe(true);
  });

  // The capability matrix must describe each transport's data-safety the way the code actually
  // behaves — these rows are asserted so the doc can never silently fall behind the code again.
  it.each([
    'src/Benzene.Aws.Lambda.Sqs',
    'src/Benzene.Aws.Sqs',
    'src/Benzene.Aws.Lambda.DynamoDb',
    // Since W3.3 (checkpoint engine ported), Kinesis reports a contiguous-prefix-watermark resume
    // point via ReportBatchItemFailures — safe by default, like its DynamoDB stream sibling.
    'src/Benzene.Aws.Lambda.Kinesis',
    'src/Benzene.Aws.Lambda.Sns',
    'src/Benzene.Aws.Lambda.S3',
    'src/Benzene.Aws.Lambda.EventBridge',
    'src/Benzene.Aws.Lambda.Kafka',
    'src/Benzene.Azure.Function.QueueStorage',
    'src/Benzene.Azure.Function.EventGrid',
    'src/Benzene.Azure.Function.ServiceBus',
    'src/Benzene.Azure.Function.Kafka',
    'src/Benzene.Azure.Function.EventHub',
    'src/Benzene.Azure.ServiceBus',
    'src/Benzene.GoogleCloud.Functions.PubSub',
    'src/Benzene.RabbitMq',
  ])('capability matrix lists %s in the safe-by-default table', (packagePath) => {
    const section = settlementSection();
    const safeStart = section.indexOf('**Safe by default**');
    const atMostOnceStart = section.indexOf('**At-most-once by default');
    expect(safeStart).toBeGreaterThanOrEqual(0);
    expect(atMostOnceStart).toBeGreaterThan(safeStart);

    const row = matrixRow(packagePath);
    const rowIndex = section.indexOf(row);
    expect(rowIndex).toBeGreaterThan(safeStart);
    expect(rowIndex).toBeLessThan(atMostOnceStart);
  });

  it.each(['src/Benzene.Kafka.Core', 'src/Benzene.Azure.EventHub'])(
    'capability matrix lists %s as at-most-once by default (the stream-worker exception)',
    (packagePath) => {
      const section = settlementSection();
      const atMostOnceStart = section.indexOf('**At-most-once by default');
      expect(atMostOnceStart).toBeGreaterThanOrEqual(0);

      const row = matrixRow(packagePath);
      expect(section.indexOf(row)).toBeGreaterThan(atMostOnceStart);
    },
  );

  // Guards the null/unrouted axis of the matrix text (Batch 4 of the .NET plan): every settlement
  // row must say something about the null-outcome behaviour, not just the failure-result axis.
  it.each([
    'src/Benzene.Aws.Lambda.Sqs',
    'src/Benzene.Aws.Sqs',
    'src/Benzene.Aws.Lambda.DynamoDb',
    'src/Benzene.Aws.Lambda.Sns',
    'src/Benzene.Aws.Lambda.S3',
    'src/Benzene.Aws.Lambda.EventBridge',
    'src/Benzene.Aws.Lambda.Kafka',
    'src/Benzene.Aws.Lambda.Kinesis',
    'src/Benzene.Azure.Function.QueueStorage',
    'src/Benzene.Azure.Function.EventGrid',
    'src/Benzene.Azure.Function.ServiceBus',
    'src/Benzene.Azure.Function.Kafka',
    'src/Benzene.Azure.Function.EventHub',
    'src/Benzene.Azure.ServiceBus',
    'src/Benzene.GoogleCloud.Functions.PubSub',
    'src/Benzene.RabbitMq',
    'src/Benzene.Kafka.Core',
    'src/Benzene.Azure.EventHub',
  ])('capability matrix row for %s describes the null/unrouted outcome', (packagePath) => {
    expect(matrixRow(packagePath)).toContain('null/unrouted outcome');
  });

  // Guards the null/unrouted axis of benzene-dotnet's work/settlement-consistency-fix-plan.md §1 —
  // a separate axis from the failure-result axis pinned above. Decided policy (maintainer,
  // 2026-08-25): retain/redeliver a null/unestablished outcome wherever a redelivery backstop
  // exists to catch it; ack it only where retaining it would be an unbreakable poison loop (the
  // Kafka x3 / Event Hub x2 carve-outs). Each assertion cites its row number from that document's
  // §1 table; do not add, remove, or "tidy up" one without reading its §0 first.
  it('null-outcome policy matches the decided table (source-level polarity pins)', () => {
    // Rows 1-3: SNS/S3/EventBridge — RETAIN (escalate on `!== true`).
    for (const file of [
      'src/Benzene.Aws.Lambda.Sns/SnsApplication.ts',
      'src/Benzene.Aws.Lambda.S3/S3Application.ts',
      'src/Benzene.Aws.Lambda.EventBridge/EventBridgeApplication.ts',
    ]) {
      const source = readRepoFile(file);
      expect(source, file).toContain('context.messageResult?.isSuccessful !== true');
      expect(source, file).not.toContain('context.messageResult?.isSuccessful === false');
    }

    // Rows 4, 5, 8: QueueStorage/EventGrid/ServiceBus triggers — RETAIN.
    for (const file of [
      'src/Benzene.Azure.Function.QueueStorage/QueueStorageApplication.ts',
      'src/Benzene.Azure.Function.EventGrid/EventGridApplication.ts',
      'src/Benzene.Azure.Function.ServiceBus/ServiceBusApplication.ts',
    ]) {
      const source = readRepoFile(file);
      expect(source, file).toContain('context.messageResult?.isSuccessful !== true');
      expect(source, file).not.toContain('context.messageResult?.isSuccessful === false');
    }

    // Row 6: Google Cloud Pub/Sub — RETAIN.
    expect(
      readRepoFile('src/Benzene.GoogleCloud.Functions.PubSub/PubSubMiddlewareApplication.ts'),
    ).toContain('context.messageResult?.isSuccessful !== true');

    // Row 7: RabbitMQ worker — RETAIN (nack). Deliberately overturns this package's previously
    // documented+tested ack-on-null behaviour — see the plan's decision register.
    expect(readRepoFile('src/Benzene.RabbitMq/RabbitMqWorker.ts')).toContain(
      'messageResult?.isSuccessful !== true',
    );

    // Rows 9-12: SQS Lambda / SQS consumer / DynamoDB / Service Bus worker — RETAIN.
    expect(readRepoFile('src/Benzene.Aws.Lambda.Sqs/SqsApplication.ts')).toContain(
      'context.isSuccessful !== true',
    );
    expect(readRepoFile('src/Benzene.Aws.Sqs/Consumer/SqsConsumerApplication.ts')).toContain(
      "isSuccessful !== true",
    );
    expect(readRepoFile('src/Benzene.Aws.Lambda.DynamoDb/DynamoDbApplication.ts')).toContain(
      'context.isSuccessful !== true',
    );
    // Kinesis (W3.3 checkpoint engine — no row in the .NET §1 table, which predates the TS port's
    // engine): the same RETAIN rule as DynamoDb — a null/unrouted outcome stops the partition's
    // group and is reported via the watermark, never checkpointed past.
    expect(readRepoFile('src/Benzene.Aws.Lambda.Kinesis/KinesisApplication.ts')).toContain(
      'context.isSuccessful !== true',
    );
    expect(readRepoFile('src/Benzene.Azure.ServiceBus/BenzeneServiceBusWorker.ts')).toContain(
      'decision.messageResult?.isSuccessful !== true',
    );

    // Rows 14-18: CARVE-OUTS — positive assertions that ack-on-null is still there. Each of these
    // must fail if someone "fixes" a carve-out to retain-on-null; no per-record dead-letter path
    // means retaining would replay the partition/batch forever.
    expect(readRepoFile('src/Benzene.Aws.Lambda.Kafka/KafkaApplication.ts')).toContain(
      'context.messageResult?.isSuccessful === false',
    ); // row 14
    expect(readRepoFile('src/Benzene.Azure.Function.Kafka/KafkaApplication.ts')).toContain(
      'context.messageResult?.isSuccessful === false',
    ); // row 15
    expect(readRepoFile('src/Benzene.Kafka.Core/BenzeneKafkaWorker.ts')).toContain(
      'messageResult?.isSuccessful === false',
    ); // row 16
    expect(readRepoFile('src/Benzene.Azure.Function.EventHub/EventHubApplication.ts')).toContain(
      'context.messageResult?.isSuccessful === false',
    ); // row 17
    expect(readRepoFile('src/Benzene.Azure.EventHub/BenzeneEventHubWorker.ts')).toContain(
      'messageResult?.isSuccessful === false',
    ); // row 18
  });
});
