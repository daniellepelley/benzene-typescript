/** Port of Benzene.Aws.Sqs.Consumer.SqsConsumer. */
import type { ReceiveMessageCommandInput } from '@aws-sdk/client-sqs';
import { ILoggerFactory, IServiceResolverFactory, NullLogger } from '@benzenejs/abstractions';
import { IBenzeneWorker } from '@benzenejs/abstractions-middleware';
import { ISqsClientFactory } from './ISqsClientFactory';
import { SqsConsumerAckMode } from './SqsConsumerAckMode';
import { SqsConsumerApplication } from './SqsConsumerApplication';
import { SqsConsumerConfig, withConfigDefaults } from './SqsConsumerConfig';
import { SqsConsumerOptions } from './SqsConsumerOptions';

/** The ceiling (in seconds) the error-path backoff grows toward on repeated receive failures. */
const MAX_ERROR_BACKOFF_SECONDS = 30;

/**
 * A long-running worker that continuously polls an SQS queue, runs received messages through the
 * middleware pipeline as a batch, and deletes them once handled.
 *
 * Uses long polling ({@link SqsConsumerConfig.waitTimeSeconds}) in a loop until `startAsync`'s
 * `AbortSignal` is signaled. By default ({@link SqsConsumerAckMode.PerMessage}), only the messages
 * whose handler reported an explicit success are deleted; a message that fails, throws, or is unrouted
 * is left on the queue individually for redelivery/DLQ redrive, regardless of the other messages in the
 * same batch. Pass {@link SqsConsumerOptions} with {@link SqsConsumerAckMode.WholeBatch} for the older
 * all-or-nothing-on-throw behavior. A poll iteration that throws for a reason other than cancellation
 * (e.g. a transient AWS error) is logged and the loop continues after a capped, geometrically-growing
 * backoff (reset on the next successful receive), rather than the exception propagating out and
 * permanently ending the worker — or a persistent failure spinning the loop with no delay.
 *
 * ADAPTATION — cancellation. C# `CancellationToken` maps to an `AbortSignal` (the {@link IBenzeneWorker}
 * mapping), and `Task.Delay(..., token)` to a signal-aware `delay` that resolves early on abort rather
 * than throwing. `using var client` has no v3 counterpart — the injected `SQSClient` the factory wraps is
 * app-owned, so it is not disposed here. Settlement is cancellation-DETACHED (.NET R10 #115): the delete
 * of already-handled messages runs without the stop signal, so a shutdown firing between the handler
 * completing and the delete still settles the work instead of silently redelivering it.
 */
export class SqsConsumer implements IBenzeneWorker {
  private readonly config: Required<SqsConsumerConfig>;
  private readonly options: SqsConsumerOptions;

  constructor(
    private readonly serviceResolverFactory: IServiceResolverFactory,
    private readonly sqsConsumerApplication: SqsConsumerApplication,
    sqsConsumerConfig: SqsConsumerConfig,
    private readonly sqsClientFactory: ISqsClientFactory,
    options: SqsConsumerOptions = {},
  ) {
    this.config = withConfigDefaults(sqsConsumerConfig);
    this.options = options;
  }

  /** Starts the poll loop, running until `cancellationToken` is signaled. */
  async startAsync(cancellationToken?: AbortSignal): Promise<void> {
    const client = this.sqsClientFactory.create();
    let consecutiveFailures = 0;
    do {
      try {
        const request: ReceiveMessageCommandInput = {
          QueueUrl: this.config.queueUrl,
          MessageAttributeNames: ['All'],
          // Request the ApproximateReceiveCount system attribute so a handler can make
          // poison-message decisions off SqsConsumerMessageContext.approximateReceiveCount.
          MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          MaxNumberOfMessages: this.config.maxNumberOfMessages,
          WaitTimeSeconds: this.config.waitTimeSeconds,
        };
        const result = await client.receiveMessageAsync(request, cancellationToken);

        // A receive (poll) that returns — even empty — means the queue is reachable again, so clear
        // the consecutive-failure count that drives the error backoff.
        consecutiveFailures = 0;

        const messages = result.Messages ?? [];
        if (messages.length > 0) {
          const batchResult = await this.sqsConsumerApplication.handleAsync(
            result,
            this.serviceResolverFactory,
          );

          // Under PerMessage (the default — `ackMode` unset is PerMessage, mirroring C#'s
          // `SqsConsumerOptions.AckMode = PerMessage` default), delete only the messages that actually
          // succeeded; a failed or unrouted message stays on the queue. Under WholeBatch, a thrown
          // exception above already skipped this whole block via the outer catch, so reaching here means
          // every message succeeded (or failed only via a non-throwing result, which WholeBatch still
          // deletes along with the rest) — delete everything.
          const messagesToDelete =
            this.options.ackMode === SqsConsumerAckMode.WholeBatch
              ? messages
              : batchResult.successfulMessages;

          if (messagesToDelete.length > 0) {
            // These messages have already been successfully processed by the pipeline, so deleting
            // them is part of graceful drain, not more work subject to the poll loop's own
            // cancellation. Deliberately pass NO abort signal here (the port of .NET's
            // `CancellationToken.None`, bounded naturally by the AWS SDK HTTP client's own timeout)
            // so a shutdown signal firing between the handler completing and this call can never
            // turn already-completed work into a silent redelivery/double-processing (.NET R10 #115).
            try {
              const deleteResult = await client.deleteMessageBatchAsync({
                QueueUrl: this.config.queueUrl,
                Entries: messagesToDelete.map((x) => ({
                  Id: x.MessageId,
                  ReceiptHandle: x.ReceiptHandle,
                })),
              });

              // A batch delete can partially fail: the call succeeds while individual entries land in
              // Failed. Those messages were NOT removed and will reappear after the visibility timeout,
              // so surface it rather than let the redelivery look unexplained.
              const failed = deleteResult.Failed ?? [];
              if (failed.length > 0) {
                await this.logDeleteFailure(
                  undefined,
                  `Failed to delete ${failed.length} handled SQS message(s) from queue ${this.config.queueUrl}; they will be redelivered: ${failed.map((x) => x.Id).join(', ')}`,
                );
              }
            } catch (error) {
              // The delete call itself failed (not a partial per-entry failure) - every message in
              // this batch will be redelivered after the visibility timeout. Contained here (not the
              // outer catch) so a delete fault is logged as a settlement failure, never mistaken for
              // a poll failure that trips the receive backoff.
              await this.logDeleteFailure(
                error,
                `Failed to delete ${messagesToDelete.length} handled SQS message(s) from queue ${this.config.queueUrl}; they will be redelivered: ${messagesToDelete.map((x) => x.MessageId).join(', ')}`,
              );
            }
          }
        }
      } catch (error) {
        if (cancellationToken?.aborted) {
          // Expected when the signal is aborted mid-poll (the underlying send rejects with an
          // AbortError); the loop condition below exits cleanly.
          continue;
        }

        const loggingScope = this.serviceResolverFactory.createScope();
        try {
          const logger =
            loggingScope.tryGetService(ILoggerFactory)?.createLogger('SqsConsumer') ??
            NullLogger.instance;
          logger.logError(error, `SQS poll iteration for queue ${this.config.queueUrl} failed`);
        } finally {
          if (loggingScope.disposeAsync) {
            await loggingScope.disposeAsync();
          } else {
            loggingScope.dispose();
          }
        }

        // The first failure retries immediately, so a lone transient blip recovers with no added
        // latency. Only a *persistent* failure (bad queue URL, denied/expired credentials, throttling,
        // an AZ outage) backs off — otherwise re-issuing receiveMessageAsync immediately would be a
        // tight loop that spins the CPU, floods the logs, and amplifies API throttling. Delay grows
        // geometrically from the second consecutive failure up to a cap, and resets on the next
        // successful receive.
        consecutiveFailures++;
        if (consecutiveFailures > 1) {
          const delaySeconds = Math.min(
            Math.pow(2, consecutiveFailures - 2),
            MAX_ERROR_BACKOFF_SECONDS,
          );
          // Cancellation-aware so shutdown still drains promptly rather than waiting out the delay.
          await delay(delaySeconds * 1000, cancellationToken);
        }
      }
    } while (!cancellationToken?.aborted);
  }

  /** Stops the worker. No cleanup is required beyond exiting the poll loop in `startAsync`. */
  async stopAsync(_cancellationToken?: AbortSignal): Promise<void> {
    return Promise.resolve();
  }

  /** Logs a settlement (delete) failure through the worker's `ILoggerFactory`/`NullLogger` scope. */
  private async logDeleteFailure(error: unknown, messageText: string): Promise<void> {
    const loggingScope = this.serviceResolverFactory.createScope();
    try {
      const logger =
        loggingScope.tryGetService(ILoggerFactory)?.createLogger('SqsConsumer') ??
        NullLogger.instance;
      logger.logError(error, messageText);
    } finally {
      if (loggingScope.disposeAsync) {
        await loggingScope.disposeAsync();
      } else {
        loggingScope.dispose();
      }
    }
  }
}

/** A signal-aware delay: resolves after `ms`, or early (without throwing) if `signal` aborts first. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
