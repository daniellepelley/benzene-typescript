/** Port of Benzene.Aws.Lambda.Kinesis.KinesisStreamCheckpointer (internal in .NET). */
import { KinesisStreamRecord } from 'aws-lambda';

/**
 * Tracks which records of a Kinesis batch have been confirmed and computes the sequence number AWS
 * should resume from if the batch didn't finish — the checkpoint engine behind
 * `KinesisApplication`'s `batchItemFailures` response.
 *
 * Tracks a **contiguous-prefix** watermark, not a single monotonic max-index one (.NET R17 #273):
 * the resume point is the first record whose original batch position hasn't been confirmed — the
 * longest fully-confirmed prefix — never simply "the highest index confirmed so far". A single
 * monotonic max-index watermark is unsound under per-partition-key processing (the model
 * `KinesisApplication` runs): one partition key's group can finish and confirm a later-index record
 * before an earlier-index record from a different key's group has even been looked at. If that
 * earlier record then fails, a max-index watermark would already have advanced past it — silently
 * reporting a record that never succeeded as done, and AWS would never retry it (silent data loss).
 * Tracking confirmed positions individually and resuming from the first gap fixes that: the failed
 * record is always reported, never skipped. Accepted tradeoff: a record confirmed ahead of an
 * earlier gap is redelivered even though it already succeeded — safe over-retry (at-least-once),
 * not the silent-skip failure mode the fix closes. For plain sequential in-order confirmation (a
 * single-partition batch), this produces byte-identical resume points to a max-index watermark.
 *
 * ADAPTATION: in .NET the checkpointer is handed to the stream handler
 * (`context.Checkpointer.CheckpointAsync(record)`); in this port's per-record engine the
 * application itself confirms each successfully-handled record, so `checkpoint` is synchronous and
 * the .NET `HasCheckpointed`/`CheckpointAll` members (which exist only for
 * `KinesisStreamOptions.AutoCheckpointOnSuccess`, a knob over handler-owned checkpointing) have no
 * counterpart here.
 */
export class KinesisStreamCheckpointer {
  private readonly records: readonly KinesisStreamRecord[];
  private readonly confirmed: boolean[];

  /** @param records The batch's records, in their original (shard) order. */
  constructor(records: readonly KinesisStreamRecord[]) {
    this.records = records;
    this.confirmed = records.map(() => false);
  }

  /**
   * Confirms a record. A record that isn't in the batch by reference equality (e.g. a
   * projected/transformed copy) is ignored — a foreign record can neither advance nor rewind the
   * watermark. A confirmed index can never become unconfirmed (there is no "unconfirm" operation).
   */
  checkpoint(lastProcessed: KinesisStreamRecord): void {
    const index = this.records.indexOf(lastProcessed);
    if (index >= 0) {
      this.confirmed[index] = true;
    }
  }

  /**
   * The sequence number of the first record that hasn't been confirmed — the longest confirmed
   * prefix's end, and the record AWS should resume the batch from — or `undefined` if every record
   * has been confirmed (or the batch is empty).
   *
   * Optional-chains through `kinesis` deliberately (.NET #162 regression): a malformed record with
   * no `kinesis` payload at the resume point must degrade to an `undefined` resume point (no
   * failure reported) instead of crashing the whole invocation and discarding the partial-resume
   * information.
   */
  get firstUncheckpointedSequenceNumber(): string | undefined {
    const firstGap = this.confirmed.indexOf(false);
    return firstGap >= 0 ? this.records[firstGap]?.kinesis?.sequenceNumber : undefined;
  }
}
