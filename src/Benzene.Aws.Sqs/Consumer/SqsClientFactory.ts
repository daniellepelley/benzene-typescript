/** Port of Benzene.Aws.Sqs.Consumer.SqsClientFactory. */
import {
  DeleteMessageBatchCommand,
  DeleteMessageBatchCommandInput,
  DeleteMessageBatchCommandOutput,
  ReceiveMessageCommand,
  ReceiveMessageCommandInput,
  ReceiveMessageCommandOutput,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { ISqsClientFactory } from './ISqsClientFactory';
import { ISqsConsumerClient } from './ISqsConsumerClient';

/**
 * An {@link ISqsClientFactory} that adapts an injected aws-sdk v3 `SQSClient` to the {@link ISqsConsumerClient}
 * seam — translating `receiveMessageAsync`/`deleteMessageBatchAsync` to the v3 command pattern. The client's
 * lifecycle is the caller's (it is not destroyed here — unlike .NET's `using var client`, the injected client
 * is shared/app-owned).
 */
export class SqsClientFactory implements ISqsClientFactory {
  constructor(private readonly amazonSqs: SQSClient) {}

  create(): ISqsConsumerClient {
    const amazonSqs = this.amazonSqs;
    return {
      receiveMessageAsync(request: ReceiveMessageCommandInput, cancellationToken?: AbortSignal): Promise<ReceiveMessageCommandOutput> {
        return amazonSqs.send(new ReceiveMessageCommand(request), { abortSignal: cancellationToken });
      },
      deleteMessageBatchAsync(request: DeleteMessageBatchCommandInput, cancellationToken?: AbortSignal): Promise<DeleteMessageBatchCommandOutput> {
        return amazonSqs.send(new DeleteMessageBatchCommand(request), { abortSignal: cancellationToken });
      },
    };
  }
}
