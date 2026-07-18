import { SQSEvent, SQSRecord } from 'aws-lambda';

/**
 * Port of Benzene.Aws.Lambda.Sqs.SqsMessageContext.
 *
 * The middleware pipeline context for a single record within an SQS batch event.
 *
 * PascalCase -> camelCase mapping: the .NET SQS event types (`Amazon.Lambda.SQSEvents`) expose the
 * batch as `SQSEvent` and each record as the nested `SQSEvent.SQSMessage`. The `@types/aws-lambda`
 * equivalents are `SQSEvent` and the top-level `SQSRecord`, whose fields are camelCase
 * (`messageId`, `body`, `messageAttributes`, `eventSource`). Only the top-level `SQSEvent.Records`
 * property stays PascalCase in `@types/aws-lambda`.
 */
export class SqsMessageContext {
  private constructor(sqsEvent: SQSEvent, sqsMessage: SQSRecord) {
    this.sqsEvent = sqsEvent;
    this.sqsMessage = sqsMessage;
  }

  /** Creates a context for a single record within an SQS batch event. Port of C# `CreateInstance`. */
  static createInstance(sqsEvent: SQSEvent, sqsMessage: SQSRecord): SqsMessageContext {
    return new SqsMessageContext(sqsEvent, sqsMessage);
  }

  /** The full SQS batch event this record belongs to. */
  readonly sqsEvent: SQSEvent;

  /** The specific SQS record this context represents. */
  readonly sqsMessage: SQSRecord;

  /**
   * Whether this record was handled successfully. Set by `SqsMessageMessageHandlerResultSetter`;
   * `undefined` if no result has been set yet (C# `bool?` maps to `boolean | undefined`).
   */
  isSuccessful?: boolean;
}
