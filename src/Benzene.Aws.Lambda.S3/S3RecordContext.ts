/** Port of Benzene.Aws.Lambda.S3.S3RecordContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { S3Event, S3EventRecord } from 'aws-lambda';

/**
 * The middleware pipeline context for a single record within an S3 event notification batch. Implements
 * the already-ported `IHasMessageResult` so `S3MessageMessageHandlerResultSetter` can record the handler
 * outcome onto it. S3 events are fire-and-forget, so the result is recorded for diagnostics rather than
 * written back to a response.
 *
 * TYPE-MODEL mapping: the .NET types (`Amazon.Lambda.S3Events`) expose the batch as `S3Event` and each
 * record as the nested `S3Event.S3EventNotificationRecord`. The `@types/aws-lambda` equivalents are
 * `S3Event` (`{ Records: S3EventRecord[] }` — `Records` stays PascalCase) and the top-level `S3EventRecord`
 * whose fields are camelCase (`record.eventSource`, `record.eventName`, `record.awsRegion`,
 * `record.s3.bucket.name`, `record.s3.object.key`/`.size`/`.eTag`).
 */
export class S3RecordContext implements IHasMessageResult {
  private constructor(s3Event: S3Event, s3EventNotificationRecord: S3EventRecord) {
    this.s3Event = s3Event;
    this.s3EventNotificationRecord = s3EventNotificationRecord;
  }

  /** Creates a context for a single record within an S3 event notification batch. Port of C# `CreateInstance`. */
  static createInstance(s3Event: S3Event, s3EventNotificationRecord: S3EventRecord): S3RecordContext {
    return new S3RecordContext(s3Event, s3EventNotificationRecord);
  }

  /** The full S3 event notification batch this record belongs to. */
  readonly s3Event: S3Event;

  /** The specific S3 event notification record this context represents. */
  readonly s3EventNotificationRecord: S3EventRecord;

  /**
   * The result of handling this record. Set by `S3MessageMessageHandlerResultSetter`; unset (C# `null`)
   * until a result has been recorded.
   */
  messageResult!: IMessageResult;
}
