/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumerApplication. */
import type { Message, ReceiveMessageCommandOutput } from '@aws-sdk/client-sqs';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewareApplicationWithResult, IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportNames } from '@benzene/abstractions-message-handlers';
import { BoundedFanOut } from '@benzene/core-middleware';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { SqsConsumerAckMode } from './SqsConsumerAckMode';
import { SqsConsumerBatchResult } from './SqsConsumerBatchResult';
import { SqsConsumerMessageContext } from './SqsConsumerMessageContext';
import { SqsConsumerOptions } from './SqsConsumerOptions';

/**
 * Processes a batch of received SQS messages by mapping each to a {@link SqsConsumerMessageContext} and
 * running them all through the middleware pipeline concurrently, tagging the transport as `"sqs"`.
 */
export class SqsConsumerApplication
  implements IMiddlewareApplicationWithResult<ReceiveMessageCommandOutput, SqsConsumerBatchResult>
{
  private readonly pipeline: IMiddlewarePipeline<SqsConsumerMessageContext>;
  private readonly options: SqsConsumerOptions;

  constructor(pipeline: IMiddlewarePipeline<SqsConsumerMessageContext>, options: SqsConsumerOptions = {}) {
    this.pipeline = new TransportMiddlewarePipeline<SqsConsumerMessageContext>(TransportNames.Sqs, pipeline);
    this.options = options;
  }

  /**
   * Handles a poll batch, running each message through the pipeline in its own service scope. Each message's
   * task RETURNS its failed `Message` (or `undefined`) rather than appending to a shared list — the tasks run
   * concurrently, so a shared-array append would race and could delete a failed message (silent loss). Under
   * `PerMessage` (default) a message's exception is contained and never propagates; under `WholeBatch` a
   * handler throwing propagates out, so the returned result is only reached when every message ran cleanly.
   */
  async handleAsync(
    event: ReceiveMessageCommandOutput,
    serviceResolverFactory: IServiceResolverFactory,
  ): Promise<SqsConsumerBatchResult> {
    const messages = event.Messages ?? [];
    const results = await BoundedFanOut.whenAllAsync(
      messages,
      async (message): Promise<Message | undefined> => {
        const context = SqsConsumerMessageContext.createInstance(message);
        try {
          const scope = serviceResolverFactory.createScope();
          try {
            await this.pipeline.handleAsync(context, scope);
          } finally {
            await scope.disposeAsync();
          }
          // Only an explicit success is deleted. A failure result OR an unset outcome (undefined
          // messageResult — e.g. an unroutable message) is reported as failed, so it stays on the queue
          // for redelivery/DLQ redrive. At-least-once: err toward redelivery.
          if (context.messageResult?.isSuccessful !== true) {
            return message;
          }
        } catch (error) {
          if (this.options.ackMode === SqsConsumerAckMode.WholeBatch) {
            throw error;
          }
          return message;
        }
        return undefined;
      },
      this.options.maxDegreeOfParallelism,
    );

    const failedMessages = results.filter((message): message is Message => message !== undefined);
    const failedSet = new Set(failedMessages);
    const successfulMessages = messages.filter((message) => !failedSet.has(message));
    return new SqsConsumerBatchResult(successfulMessages, failedMessages);
  }
}
