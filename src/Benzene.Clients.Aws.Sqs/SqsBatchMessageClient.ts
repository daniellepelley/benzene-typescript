import { SendMessageBatchCommand, SendMessageBatchRequestEntry, SQSClient } from '@aws-sdk/client-sqs';
import { ISerializer } from '@benzenejs/abstractions';
import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import {
  BatchSend,
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzenejs/clients';
import { OutboundSqsContextConverter } from './OutboundSqsContextConverter';
import { awsErrorDetails } from './awsErrorDetails';

/** SQS caps a `SendMessageBatch` at 10 entries per call. */
const MAX_BATCH_SIZE = 10;

/** The AWS error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = awsErrorDetails(error).errorCode;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Sends messages to an SQS queue using the native `SendMessageBatch` (up to 10 per call) instead of one
 * `SendMessage` per message. Each entry is built by the same {@link OutboundSqsContextConverter} the
 * single-send path uses, so a batched message is byte-for-byte what `useSqs` would have sent; each entry's
 * id carries the caller's index, so `SendMessageBatch`'s per-entry `Failed` list — and any chunk-level
 * throw — maps straight back to a {@link FailedBatchEntry} against the original request collection.
 * Port of Benzene.Clients.Aws.Sqs.SqsBatchMessageClient.
 *
 * PORT DIVERGENCE (matching `useSqs`): the `SQSClient` is passed explicitly rather than resolved from the
 * container — see `OutboundSqsContextConverter`.
 */
export class SqsBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundSqsContextConverter;

  constructor(
    private readonly amazonSqs: SQSClient,
    private readonly queueUrl: string,
    topicAttributeKey: string = OutboundSqsContextConverter.DefaultTopicAttribute,
    serializer?: ISerializer,
  ) {
    this.converter = new OutboundSqsContextConverter(queueUrl, topicAttributeKey, serializer);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    for (const chunk of BatchSend.chunk(requests, MAX_BATCH_SIZE)) {
      const entries: SendMessageBatchRequestEntry[] = [];
      for (const { item, index } of chunk) {
        try {
          const context = await this.converter.createRequestAsync(
            new OutboundContext(item.topic, item.message, item.headers),
          );
          entries.push({
            // The entry id carries the caller's index so a failure maps straight back.
            Id: index.toString(),
            MessageBody: context.request.MessageBody,
            MessageAttributes: context.request.MessageAttributes,
          });
        } catch (error) {
          // A single entry that can't be built (e.g. a serialization failure) fails just that entry,
          // rather than aborting the whole batch after earlier chunks already sent.
          failures.push(failure(index, error));
        }
      }

      if (entries.length === 0) {
        continue;
      }

      try {
        const response = await this.amazonSqs.send(
          new SendMessageBatchCommand({ QueueUrl: this.queueUrl, Entries: entries }),
        );
        for (const failed of response.Failed ?? []) {
          failures.push(new FailedBatchEntry(Number(failed.Id), failed.Code, failed.Message));
        }
      } catch (error) {
        // A chunk-level transport failure (throttle, network, expired credentials) fails this chunk's
        // entries rather than escaping and discarding the successes/failures already recorded for earlier
        // chunks. The caller then resends only what's reported failed, not the whole collection.
        for (const entry of entries) {
          failures.push(failure(Number(entry.Id), error));
        }
      }
    }

    return new BatchSendResult(failures);
  }
}
