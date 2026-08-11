import { CreateBatchOptions, EventDataBatch, EventHubProducerClient } from '@azure/event-hubs';
import { ISerializer } from '@benzene/abstractions';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import {
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzene/clients';
import { EventHubSendMessageContext } from './EventHubSendMessageContext';
import { OutboundEventHubContextConverter } from './OutboundEventHubContextConverter';

/** The error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Sends messages to Azure Event Hubs using native `EventDataBatch` objects (`createBatch` + `tryAdd` +
 * `sendBatch`) instead of one send per event. Each event is built by the same
 * {@link OutboundEventHubContextConverter} the single-send path uses.
 * Port of Benzene.Clients.Azure.EventHub.EventHubBatchMessageClient.
 *
 * A batch is bound to a single partition key, so events are grouped by their resolved partition key before
 * batching; within each group events are packed into size-bounded batches (`tryAdd` returning false starts
 * a new batch). Failures are reported at batch granularity — a `sendBatch` throw fails every event in that
 * batch, against its index in the original request collection — plus per-event `EventTooLarge` for an event
 * that can't fit an empty batch. (Unlike .NET, the JS `EventDataBatch` isn't disposable; it's GC'd.)
 */
export class EventHubBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundEventHubContextConverter;

  constructor(
    private readonly producerClient: EventHubProducerClient,
    topicPropertyKey: string = OutboundEventHubContextConverter.DefaultTopicProperty,
    partitionKeyHeader?: string,
    serializer?: ISerializer,
  ) {
    this.converter = new OutboundEventHubContextConverter(topicPropertyKey, partitionKeyHeader, serializer);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    // A batch is bound to one partition key, so group by the resolved key before batching.
    const groups = new Map<string, { context: EventHubSendMessageContext; index: number }[]>();
    let index = 0;
    for (const item of requests) {
      let context: EventHubSendMessageContext;
      try {
        context = await this.converter.createRequestAsync(new OutboundContext(item.topic, item.message, item.headers));
      } catch (error) {
        // A single event that can't be built fails just that entry, matching the AWS clients' contract.
        failures.push(failure(index, error));
        index++;
        continue;
      }
      const key = context.partitionKey ?? '';
      const group = groups.get(key) ?? [];
      group.push({ context, index });
      groups.set(key, group);
      index++;
    }

    for (const [key, group] of groups) {
      await this.sendGroup(key, group, failures);
    }

    return new BatchSendResult(failures);
  }

  private async sendGroup(
    partitionKey: string,
    group: { context: EventHubSendMessageContext; index: number }[],
    failures: FailedBatchEntry[],
  ): Promise<void> {
    const options: CreateBatchOptions = partitionKey === '' ? {} : { partitionKey };

    let batch = await this.producerClient.createBatch(options);
    let batchIndices: number[] = [];

    for (const { context, index } of group) {
      if (!batch.tryAdd(context.eventData)) {
        if (batchIndices.length === 0) {
          failures.push(new FailedBatchEntry(index, 'EventTooLarge', 'The event is too large to fit in a single Event Hubs batch.'));
          continue;
        }

        await this.sendAndTrack(batch, batchIndices, failures);
        batch = await this.producerClient.createBatch(options);
        batchIndices = [];

        if (!batch.tryAdd(context.eventData)) {
          failures.push(new FailedBatchEntry(index, 'EventTooLarge', 'The event is too large to fit in a single Event Hubs batch.'));
          continue;
        }
      }
      batchIndices.push(index);
    }

    if (batchIndices.length > 0) {
      await this.sendAndTrack(batch, batchIndices, failures);
    }
  }

  private async sendAndTrack(batch: EventDataBatch, batchIndices: number[], failures: FailedBatchEntry[]): Promise<void> {
    try {
      await this.producerClient.sendBatch(batch);
    } catch (error) {
      // A batch-level send failure fails every event in that batch (Service Bus/Event Hub batch sends are
      // atomic — there is no per-event acknowledgement), against its original index.
      for (const index of batchIndices) {
        failures.push(failure(index, error));
      }
    }
  }
}
