/** Port of Benzene.Azure.EventHub.EventProcessorClientFactory. */
import { EventHubConsumerClient } from '@azure/event-hubs';
import { IEventProcessorClientFactory } from './IEventProcessorClientFactory';

/**
 * An {@link IEventProcessorClientFactory} that returns the injected {@link EventHubConsumerClient}
 * instance. The caller builds the client (hub, consumer group, checkpoint store, authentication); the
 * client's lifecycle is the caller's.
 */
export class EventProcessorClientFactory implements IEventProcessorClientFactory {
  constructor(private readonly eventHubConsumerClient: EventHubConsumerClient) {}

  create(): EventHubConsumerClient {
    return this.eventHubConsumerClient;
  }
}
