import { describe, expect, it } from 'vitest';
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addKinesis,
  KinesisApplication,
  KinesisMessageContext,
  KinesisStreamCheckpointer,
} from '@benzenejs/aws-lambda-kinesis';

/**
 * Port of test/Benzene.Core.Test/Aws/Kinesis/KinesisStreamApplicationTest.cs (benzene-dotnet) —
 * the checkpoint/resume behaviour of the Kinesis checkpoint engine (W3.3), including the R17 #273
 * contiguous-prefix watermark. The C# tests drive a `UseStream` handler that checkpoints explicitly;
 * this port's engine routes per record and confirms each success itself, so the scenarios are driven
 * by a per-record outcome function ('ok' | 'fail' | 'unset' | 'throw') instead. Outcomes .NET's
 * options control (`AutoCheckpointOnSuccess`/`CatchExceptions`) are inherent here — a successful
 * batch auto-advances, and a per-record throw is caught with the resume point still returned.
 */

type Outcome = 'ok' | 'fail' | 'unset' | 'throw';

function record(sequenceNumber: string, partitionKey = 'A'): KinesisStreamRecord {
  return {
    awsRegion: 'us-east-1',
    eventID: `shardId-000000000000:${sequenceNumber}`,
    eventName: 'aws:kinesis:record',
    eventSource: 'aws:kinesis',
    eventSourceARN: 'arn:aws:kinesis:us-east-1:123456789012:stream/orders',
    eventVersion: '1.0',
    invokeIdentityArn: 'arn:aws:iam::123456789012:role/lambda',
    kinesis: {
      approximateArrivalTimestamp: 0,
      data: Buffer.from('{}').toString('base64'),
      kinesisSchemaVersion: '1.0',
      partitionKey,
      sequenceNumber,
    },
  };
}

/** A record with no `kinesis` payload at all (a malformed delivery). */
function malformedRecord(): KinesisStreamRecord {
  return { eventSource: 'aws:kinesis', eventID: 'shardId-1' } as unknown as KinesisStreamRecord;
}

/**
 * Runs the given records through a `KinesisApplication` whose pipeline resolves each record's
 * outcome by sequence number, recording the order records were handled in.
 */
async function run(
  records: KinesisStreamRecord[],
  outcome: (sequenceNumber: string | undefined) => Outcome,
): Promise<{ failures: string[]; handled: string[] }> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addKinesis(container);

  const handled: string[] = [];
  const pipeline = new MiddlewarePipelineBuilder<KinesisMessageContext>(container);
  pipeline.useFn(async (context, next) => {
    const sequenceNumber = context.record.kinesis?.sequenceNumber;
    handled.push(sequenceNumber ?? '<malformed>');
    switch (outcome(sequenceNumber)) {
      case 'throw':
        throw new Error(`record ${sequenceNumber} blew up`);
      case 'fail':
        context.isSuccessful = false;
        break;
      case 'unset':
        break; // an unrouted record: no result setter ever ran
      case 'ok':
        context.isSuccessful = true;
        break;
    }
    await next();
  });

  const event: KinesisStreamEvent = { Records: records };
  const response = await new KinesisApplication(pipeline.build()).handleAsync(
    event,
    container.createServiceResolverFactory(),
  );

  return { failures: response.batchItemFailures.map((f) => f.itemIdentifier), handled };
}

describe('KinesisApplication (checkpoint engine)', () => {
  it('reports no failures when every record succeeds', async () => {
    const { failures, handled } = await run(
      [record('1'), record('2'), record('3')],
      () => 'ok',
    );

    expect(failures).toEqual([]);
    expect(handled).toEqual(['1', '2', '3']);
  });

  it('a throw after two successes reports the third record and stops the partition', async () => {
    const { failures, handled } = await run(
      [record('1'), record('2'), record('3'), record('4'), record('5')],
      (seq) => (seq === '3' ? 'throw' : 'ok'),
    );

    expect(failures).toEqual(['3']);
    // Stop-at-first-failure: records 4 and 5 are never handled (shard order preserved on retry).
    expect(handled).toEqual(['1', '2', '3']);
  });

  it('a returned failure result settles exactly like a throw (reported, partition stopped)', async () => {
    const { failures, handled } = await run(
      [record('1'), record('2'), record('3')],
      (seq) => (seq === '2' ? 'fail' : 'ok'),
    );

    expect(failures).toEqual(['2']);
    expect(handled).toEqual(['1', '2']);
  });

  it('a null/unrouted outcome is retained for redelivery, not checkpointed past', async () => {
    // The null-outcome axis: a record whose result setter never ran (no handler matched the topic)
    // must be reported for redelivery — matching the DynamoDB adapter's `isSuccessful !== true` rule.
    const { failures, handled } = await run(
      [record('1'), record('2'), record('3')],
      (seq) => (seq === '2' ? 'unset' : 'ok'),
    );

    expect(failures).toEqual(['2']);
    expect(handled).toEqual(['1', '2']);
  });

  it('a throw before anything succeeds reports the first record', async () => {
    const { failures } = await run([record('1'), record('2')], () => 'throw');

    expect(failures).toEqual(['1']);
  });

  it('an empty batch reports no failures', async () => {
    const { failures } = await run([], () => 'ok');
    expect(failures).toEqual([]);
  });

  it('an event with no Records array reports no failures', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addKinesis(container);
    const pipeline = new MiddlewarePipelineBuilder<KinesisMessageContext>(container);

    const response = await new KinesisApplication(pipeline.build()).handleAsync(
      {} as KinesisStreamEvent,
      container.createServiceResolverFactory(),
    );

    expect(response).toEqual({ batchItemFailures: [] });
  });

  it('#273: an earlier partition failure is not skipped by a later partition checkpoint', async () => {
    // Batch (shard) order is A-1, B-1, A-2, B-2. Partition A's group runs to completion and
    // confirms A-1 and A-2 — including index 2, PAST partition B's failed B-1 at index 1. A
    // monotonic max-index watermark would have advanced past B-1 and reported B-2, silently
    // treating B-1 (never confirmed) as done. The contiguous-prefix watermark must report B-1 —
    // the first unconfirmed index — and never past it.
    const { failures, handled } = await run(
      [record('A-1', 'A'), record('B-1', 'B'), record('A-2', 'A'), record('B-2', 'B')],
      (seq) => (seq === 'B-1' ? 'throw' : 'ok'),
    );

    expect(failures).toEqual(['B-1']);
    // Partition A ran to the end regardless (per-key ordering, concurrent groups); partition B
    // stopped at its first failure so B-2 was never handled.
    expect(handled.filter((h) => h.startsWith('A-'))).toEqual(['A-1', 'A-2']);
    expect(handled).not.toContain('B-2');
  });

  it('#273 regression: sequential in-order confirmation matches the old max-index watermark byte-for-byte', async () => {
    // For a plain single-partition batch confirmed strictly in order (no gaps), the
    // contiguous-prefix watermark must produce exactly the resume point a max-index watermark did.
    const { failures } = await run(
      [record('1'), record('2'), record('3'), record('4'), record('5')],
      (seq) => (seq === '4' ? 'throw' : 'ok'),
    );

    expect(failures).toEqual(['4']);
  });

  it('#162 regression: a malformed record at the resume point degrades to no reported failure', async () => {
    // The record at the resume point has no `kinesis` payload, so no sequence number can be named.
    // This must degrade to an empty batchItemFailures rather than crash the invocation.
    const { failures } = await run(
      [record('1'), malformedRecord()],
      (seq) => (seq === '1' ? 'ok' : 'throw'),
    );

    expect(failures).toEqual([]);
  });
});

describe('KinesisStreamCheckpointer', () => {
  it('ignores a foreign record (not in the batch by reference) — the watermark never rewinds', async () => {
    const records = [record('1'), record('2'), record('3')];
    const checkpointer = new KinesisStreamCheckpointer(records);

    checkpointer.checkpoint(records[0]!);
    checkpointer.checkpoint(records[1]!);
    checkpointer.checkpoint(record('2')); // an equal-looking COPY, not the batch's instance

    expect(checkpointer.firstUncheckpointedSequenceNumber).toBe('3');
  });

  it('reports undefined for an empty batch and once every record is confirmed', () => {
    expect(new KinesisStreamCheckpointer([]).firstUncheckpointedSequenceNumber).toBeUndefined();

    const records = [record('1')];
    const checkpointer = new KinesisStreamCheckpointer(records);
    expect(checkpointer.firstUncheckpointedSequenceNumber).toBe('1');
    checkpointer.checkpoint(records[0]!);
    expect(checkpointer.firstUncheckpointedSequenceNumber).toBeUndefined();
  });
});
