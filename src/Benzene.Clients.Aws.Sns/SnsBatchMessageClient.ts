import { PublishBatchCommand, PublishBatchRequestEntry, SNSClient } from '@aws-sdk/client-sns';
import { ISerializer } from '@benzenejs/abstractions';
import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import {
  BatchSend,
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzenejs/clients';
import { OutboundSnsContextConverter } from './OutboundSnsContextConverter';
import { awsErrorDetails } from './awsErrorDetails';

/** SNS caps a `PublishBatch` at 10 entries per call. */
const MAX_BATCH_SIZE = 10;

/** The AWS error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = awsErrorDetails(error).errorCode;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Publishes messages to an SNS topic using the native `PublishBatch` (up to 10 per call) instead of one
 * `Publish` per message. Each entry is built by the same {@link OutboundSnsContextConverter} the single-send
 * path uses, so a batched message is byte-for-byte what `useSns` would have published; each entry's id
 * carries the caller's index, so `PublishBatch`'s per-entry `Failed` list — and any chunk-level throw — maps
 * straight back to a {@link FailedBatchEntry} against the original request collection.
 * Port of Benzene.Clients.Aws.Sns.SnsBatchMessageClient.
 *
 * PORT DIVERGENCE (matching `useSns`): the `SNSClient` is passed explicitly rather than resolved from the
 * container — see `OutboundSnsContextConverter`.
 */
export class SnsBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundSnsContextConverter;

  constructor(
    private readonly amazonSns: SNSClient,
    private readonly topicArn: string,
    topicAttributeKey: string = OutboundSnsContextConverter.DefaultTopicAttribute,
    serializer?: ISerializer,
  ) {
    this.converter = new OutboundSnsContextConverter(topicArn, topicAttributeKey, serializer);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    for (const chunk of BatchSend.chunk(requests, MAX_BATCH_SIZE)) {
      const entries: PublishBatchRequestEntry[] = [];
      for (const { item, index } of chunk) {
        try {
          const context = await this.converter.createRequestAsync(
            new OutboundContext(item.topic, item.message, item.headers),
          );
          entries.push({
            Id: index.toString(),
            Message: context.request.Message,
            MessageAttributes: context.request.MessageAttributes,
          });
        } catch (error) {
          failures.push(failure(index, error));
        }
      }

      if (entries.length === 0) {
        continue;
      }

      try {
        const response = await this.amazonSns.send(
          new PublishBatchCommand({ TopicArn: this.topicArn, PublishBatchRequestEntries: entries }),
        );
        for (const failed of response.Failed ?? []) {
          failures.push(new FailedBatchEntry(Number(failed.Id), failed.Code, failed.Message));
        }
      } catch (error) {
        for (const entry of entries) {
          failures.push(failure(Number(entry.Id), error));
        }
      }
    }

    return new BatchSendResult(failures);
  }
}
