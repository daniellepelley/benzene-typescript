/** Port of Benzene.Azure.EventHub.IEventProcessorClientFactory. */
import { EventHubConsumerClient } from '@azure/event-hubs';

/**
 * Creates the underlying client {@link BenzeneEventHubWorker} uses to consume an Event Hub. Lets the
 * caller decide the hub, consumer group, blob checkpoint container, and authentication (connection
 * string, Managed Identity via a `TokenCredential`, emulator, …) without the worker prescribing any of it.
 *
 * PORTING NOTE: .NET's `EventProcessorClient` (from `Azure.Messaging.EventHubs.Processor`) maps to the JS
 * `EventHubConsumerClient` constructed with a `CheckpointStore` (e.g.
 * `@azure/eventhubs-checkpointstore-blob`) — that pairing is the JS equivalent of the processor client
 * (automatic partition load-balancing + checkpointed offsets via `subscribe`). The interface name is kept
 * from C#; the created type is the JS equivalent. Like the SQS/Service Bus factories, it is passed
 * directly to `useEventHub` (not resolved from the container), so it declares no `ServiceToken`.
 */
export interface IEventProcessorClientFactory {
  /** Creates the consumer client. The caller owns its lifecycle. */
  create(): EventHubConsumerClient;
}
