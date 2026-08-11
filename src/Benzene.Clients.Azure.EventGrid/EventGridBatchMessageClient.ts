import { EventGridPublisherClient, InputSchema, SendCloudEventInput } from '@azure/eventgrid';
import { IBenzeneClientRequest } from '@benzene/abstractions-messages';
import {
  BatchSend,
  BatchSendResult,
  FailedBatchEntry,
  IBenzeneBatchMessageClient,
  OutboundContext,
} from '@benzene/clients';
import { OutboundEventGridContextConverter } from './OutboundEventGridContextConverter';

/** The default number of events per Event Grid request; the ~1 MB request cap still applies. */
export const EVENT_GRID_MAX_BATCH_SIZE = 100;

/** The error code + message for a thrown error, for a {@link FailedBatchEntry}. */
function failure(index: number, error: unknown): FailedBatchEntry {
  const code = error instanceof Error ? error.name : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new FailedBatchEntry(index, code, message);
}

/**
 * Publishes events to Azure Event Grid in batches (`publisherClient.send([...])`) instead of one send per
 * event. Each event is built by the same {@link OutboundEventGridContextConverter} the single-send path uses
 * (a CloudEvents 1.0 event whose `type` is the topic).
 * Port of Benzene.Clients.Azure.EventGrid.EventGridBatchMessageClient.
 *
 * Requests are chunked to `batchSize` (default 100; the Event Grid ~1 MB request cap still applies). An
 * Event Grid `send` is atomic, so a throw fails every event that actually made it into that request, against
 * its index in the original request collection; a per-event build (serialization) failure fails just that
 * entry.
 */
export class EventGridBatchMessageClient implements IBenzeneBatchMessageClient {
  private readonly converter: OutboundEventGridContextConverter;

  constructor(
    source: string,
    private readonly publisherClient: EventGridPublisherClient<InputSchema>,
    private readonly batchSize: number = EVENT_GRID_MAX_BATCH_SIZE,
  ) {
    this.converter = new OutboundEventGridContextConverter(source);
  }

  async sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult> {
    const failures: FailedBatchEntry[] = [];

    for (const chunk of BatchSend.chunk(requests, this.batchSize)) {
      const events: SendCloudEventInput<unknown>[] = [];
      const sentIndices: number[] = [];
      for (const { item, index } of chunk) {
        try {
          const context = await this.converter.createRequestAsync(new OutboundContext(item.topic, item.message, item.headers));
          events.push(context.cloudEvent!);
          sentIndices.push(index);
        } catch (error) {
          // A single event that can't be built fails just that entry, rather than aborting the whole chunk.
          failures.push(failure(index, error));
        }
      }

      if (events.length === 0) {
        continue;
      }

      try {
        await this.publisherClient.send(events);
      } catch (error) {
        // Atomic send: on a throw every event that made it into this request failed (the conversion
        // failures above are already recorded and are not re-counted here).
        for (const index of sentIndices) {
          failures.push(failure(index, error));
        }
      }
    }

    return new BatchSendResult(failures);
  }
}
