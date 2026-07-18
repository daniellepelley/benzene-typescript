/** Port of Benzene.Aws.Lambda.Kinesis (record context — see the ADAPTATION note below). */
import { KinesisStreamEvent, KinesisStreamRecord } from 'aws-lambda';

/**
 * The middleware pipeline context for a single record within a Kinesis Data Streams batch.
 *
 * STREAMING -> PER-RECORD FAN-OUT ADAPTATION: the C# `Benzene.Aws.Lambda.Kinesis` is built on the
 * streaming engine (`StreamMiddlewareApplication` / `StreamContext<KinesisEventRecord>` / `UseStream`),
 * exposing the whole batch as one `IAsyncEnumerable` (fan-in). That streaming engine is NOT yet ported to
 * this repo (see the README roadmap — streaming is a later phase), so this adapter instead mirrors the
 * SQS/SNS PER-RECORD fan-out shape already established here: one `KinesisMessageContext` per record routed
 * to a `@message` handler by topic. This is a deliberate, documented divergence from the C# streaming
 * model; when the streaming engine is ported, this package can be revisited to match `KinesisStreamApplication`.
 *
 * Field mapping (`@types/aws-lambda`, `KinesisStreamRecord`): `record.eventSource`, `record.eventID`,
 * `record.kinesis.data` (base64), `record.kinesis.partitionKey`, `record.kinesis.sequenceNumber`.
 */
export class KinesisMessageContext {
  private constructor(kinesisEvent: KinesisStreamEvent, record: KinesisStreamRecord) {
    this.kinesisEvent = kinesisEvent;
    this.record = record;
  }

  /** Creates a context for a single record within a Kinesis batch event. */
  static createInstance(
    kinesisEvent: KinesisStreamEvent,
    record: KinesisStreamRecord,
  ): KinesisMessageContext {
    return new KinesisMessageContext(kinesisEvent, record);
  }

  /** The full Kinesis batch event this record belongs to. */
  readonly kinesisEvent: KinesisStreamEvent;

  /** The specific Kinesis record this context represents. */
  readonly record: KinesisStreamRecord;

  /**
   * Whether this record was handled successfully. Set by `KinesisMessageMessageHandlerResultSetter`;
   * `undefined` if no result has been set yet.
   */
  isSuccessful?: boolean;
}
