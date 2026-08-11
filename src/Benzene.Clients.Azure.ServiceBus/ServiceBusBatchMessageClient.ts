import { ServiceBusMessageBatch, ServiceBusSender } from '@azure/service-bus';
import { ISerializer } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import {
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzene/clients';
import { OutboundServiceBusContextConverter } from './OutboundServiceBusContextConverter';

/** The error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Sends messages to a Service Bus queue or topic using a native `ServiceBusMessageBatch`: messages are
 * packed into size-bounded batches (`createMessageBatch` + `tryAddMessage`) and each full batch is sent with
 * a single `sendMessages` call. Each message is built by the same {@link OutboundServiceBusContextConverter}
 * the single-send path uses.
 * Port of Benzene.Clients.Azure.ServiceBus.ServiceBusBatchMessageClient.
 *
 * A Service Bus batch send is atomic — it accepts every message or throws — so failures are reported at
 * batch granularity: a `sendMessages` throw fails every message in that batch, against its index in the
 * original request collection. A message too large to fit an empty batch is its own failure without
 * aborting the rest.
 */
export class ServiceBusBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundServiceBusContextConverter;

  constructor(
    private readonly sender: ServiceBusSender,
    topicPropertyKey: string = OutboundServiceBusContextConverter.DefaultTopicProperty,
    serializer?: ISerializer,
  ) {
    this.converter = new OutboundServiceBusContextConverter(topicPropertyKey, serializer);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    let batch = await this.sender.createMessageBatch();
    let batchIndices: number[] = [];
    let index = 0;

    for (const item of requests) {
      let message;
      try {
        const context = await this.converter.createRequestAsync(new OutboundContext(item.topic, item.message, item.headers));
        message = context.message;
      } catch (error) {
        // A single message that can't be built fails just that entry, rather than aborting the whole send.
        failures.push(failure(index, error));
        index++;
        continue;
      }

      if (!batch.tryAddMessage(message)) {
        if (batchIndices.length === 0) {
          failures.push(new FailedBatchEntry(index, 'MessageTooLarge', 'The message is too large to fit in a single Service Bus batch.'));
          index++;
          continue;
        }

        await this.sendAndTrack(batch, batchIndices, failures);
        batch = await this.sender.createMessageBatch();
        batchIndices = [];

        if (!batch.tryAddMessage(message)) {
          failures.push(new FailedBatchEntry(index, 'MessageTooLarge', 'The message is too large to fit in a single Service Bus batch.'));
          index++;
          continue;
        }
      }
      batchIndices.push(index);
      index++;
    }

    if (batchIndices.length > 0) {
      await this.sendAndTrack(batch, batchIndices, failures);
    }

    return new BatchSendResult(failures);
  }

  private async sendAndTrack(batch: ServiceBusMessageBatch, batchIndices: number[], failures: FailedBatchEntry[]): Promise<void> {
    try {
      await this.sender.sendMessages(batch);
    } catch (error) {
      for (const index of batchIndices) {
        failures.push(failure(index, error));
      }
    }
  }
}
