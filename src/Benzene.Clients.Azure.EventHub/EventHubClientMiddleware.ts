/** Port of Benzene.Clients.Azure.EventHub.EventHubClientMiddleware. */
import { CreateBatchOptions, EventHubProducerClient } from '@azure/event-hubs';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { EventHubSendMessageContext } from './EventHubSendMessageContext';

/**
 * Terminal middleware that sends the context's event via an `EventHubProducerClient`, as a single-event
 * batch, and records that the send completed. It does not call `next`. The producer client returns no
 * payload, so success is a completed send. `EventHubProducerClient.SendAsync(EventData)` →
 * `producer.createBatch(...)` + `batch.tryAdd(event)` + `producer.sendBatch(batch)`.
 *
 * PORTING NOTE: the .NET `using var batch` has no counterpart — the JS `EventDataBatch` isn't disposable
 * (it's GC'd).
 */
export class EventHubClientMiddleware implements IMiddleware<EventHubSendMessageContext> {
  readonly name = 'EventHubClientMiddleware';

  constructor(private readonly producerClient: EventHubProducerClient) {}

  async handleAsync(context: EventHubSendMessageContext, _next: NextFunc): Promise<void> {
    // A partition key co-locates related events on one partition (preserving their order); without it
    // Event Hubs round-robins across partitions. The batch's key must be set at creation time.
    const batchOptions: CreateBatchOptions =
      context.partitionKey === undefined || context.partitionKey === ''
        ? {}
        : { partitionKey: context.partitionKey };

    const batch = await this.producerClient.createBatch(batchOptions);
    if (!batch.tryAdd(context.eventData)) {
      throw new Error('The event is too large to fit in a single Event Hubs batch.');
    }

    await this.producerClient.sendBatch(batch);
    context.isSent = true;
  }
}
