/** Port of Benzene.Aws.Lambda.Sns.SnsRecordContext. */
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';
import { SNSEvent, SNSEventRecord } from 'aws-lambda';

/**
 * The middleware pipeline context for a single record within an SNS batch event. Implements the
 * already-ported `IHasMessageResult` so `SnsMessageMessageHandlerResultSetter` can record the handler
 * outcome onto it (which `SnsApplication` reads for `SnsOptions.raiseOnFailureStatus`).
 *
 * PascalCase mapping: the .NET SNS types (`Amazon.Lambda.SNSEvents`) expose the batch as `SNSEvent`
 * and each record as the nested `SNSEvent.SNSRecord`. The `@types/aws-lambda` equivalents are `SNSEvent`
 * and the top-level `SNSEventRecord`. NOTE: unlike SQS, the SNS record fields in `@types/aws-lambda` are
 * ENTIRELY PascalCase — `record.EventSource`, `record.Sns` (an `SNSMessage`), `Sns.Message`,
 * `Sns.MessageAttributes` (each `{ Type, Value }`), `Sns.MessageId`, `Sns.Subject` — so the getters read
 * PascalCase members here, matching the .NET original member-for-member.
 */
export class SnsRecordContext implements IHasMessageResult {
  private constructor(snsEvent: SNSEvent, snsRecord: SNSEventRecord) {
    this.snsEvent = snsEvent;
    this.snsRecord = snsRecord;
  }

  /** Creates a context for a single record within an SNS batch event. Port of C# `CreateInstance`. */
  static createInstance(snsEvent: SNSEvent, snsRecord: SNSEventRecord): SnsRecordContext {
    return new SnsRecordContext(snsEvent, snsRecord);
  }

  /** The full SNS batch event this record belongs to. */
  readonly snsEvent: SNSEvent;

  /** The specific SNS record this context represents. */
  readonly snsRecord: SNSEventRecord;

  /**
   * The result of handling this record. Set by `SnsMessageMessageHandlerResultSetter`; unset (C# `null`)
   * until a result has been recorded — `SnsApplication` reads it via optional chaining, exactly as C#
   * reads `MessageResult?.IsSuccessful`.
   */
  messageResult!: IMessageResult;
}
