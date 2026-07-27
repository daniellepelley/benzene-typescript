/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerMessageContext. */
import type { Message } from '@aws-sdk/client-sqs';
import { IHasMessageResult, IMessageResult } from '@benzene/abstractions-message-handlers';

/**
 * The middleware pipeline context for a single SQS message received by the polling consumer. `Amazon.SQS.
 * Model.Message` maps to the `@aws-sdk/client-sqs` `Message` type (PascalCase fields: `Body`,
 * `MessageId`, `ReceiptHandle`, `Attributes`, `MessageAttributes`).
 */
export class SqsConsumerMessageContext implements IHasMessageResult {
  private constructor(readonly message: Message) {}

  /** Creates a new context for a received SQS message. Port of C# `CreateInstance`. */
  static createInstance(message: Message): SqsConsumerMessageContext {
    return new SqsConsumerMessageContext(message);
  }

  /**
   * The number of times this message has been received (SQS's `ApproximateReceiveCount` system attribute),
   * or `undefined` when absent. A handler can use it for poison-message decisions. Requested by
   * {@link SqsConsumer} on each receive.
   */
  get approximateReceiveCount(): number | undefined {
    const value = this.message.Attributes?.['ApproximateReceiveCount'];
    if (value === undefined) {
      return undefined;
    }
    const count = Number.parseInt(value, 10);
    return Number.isNaN(count) ? undefined : count;
  }

  /**
   * The result of handling this message. Set by `SqsConsumerMessageHandlerResultSetter`; read by
   * `SqsConsumerApplication` to support `SqsConsumerAckMode.PerMessage`. `undefined` until set (e.g. an
   * unroutable message whose result setter never ran).
   */
  messageResult!: IMessageResult;
}
