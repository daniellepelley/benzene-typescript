/** The SQS operations the polling consumer needs, adapted from .NET's `IAmazonSQS`. */
import type {
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
} from '@aws-sdk/client-sqs';

/**
 * TypeScript-only seam with no direct C# counterpart. .NET's `SqsConsumer` calls
 * `IAmazonSQS.ReceiveMessageAsync` / `DeleteMessageBatchAsync` directly; the aws-sdk v3 client instead uses
 * `client.send(new XCommand(...))`, so the port defines the two operations the consumer needs as a small
 * interface (implemented by {@link SqsClientFactory}'s wrapper over a v3 `SQSClient`). This also gives tests
 * a trivial mock seam. `AbortSignal` replaces the `CancellationToken`.
 */
export interface ISqsConsumerClient {
  receiveMessageAsync(request: ReceiveMessageCommandInput, cancellationToken?: AbortSignal): Promise<ReceiveMessageCommandOutput>;
  deleteMessageBatchAsync(request: DeleteMessageBatchCommandInput, cancellationToken?: AbortSignal): Promise<DeleteMessageBatchCommandOutput>;
}
