/** Port of Benzene.Clients.Azure.EventHub.EventHubSendMessageContext. */
import { EventData } from '@azure/event-hubs';

/**
 * The middleware pipeline context for sending a single event to Azure Event Hubs.
 *
 * MESSAGE-TYPE ADAPTATION: .NET's `Azure.Messaging.EventHubs.EventData` maps to the same conceptual
 * type from `@azure/event-hubs` (an object literal with `body`/`properties`).
 */
export class EventHubSendMessageContext {
  /**
   * Whether the event was sent. Set by `EventHubClientMiddleware` once the send completes without
   * throwing — the producer client returns no payload, so a completed send is an acknowledgement only.
   */
  isSent = false;

  /**
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to `createBatch`/`sendBatch` as `abortSignal`, so an aborted caller aborts
   * the outbound send instead of running it to completion.
   */
  signal?: AbortSignal;

  /**
   * @param eventData The event to send.
   * @param partitionKey The partition key that co-locates related events on the same partition
   *   (preserving their order), or `undefined` to let Event Hubs distribute the event across partitions.
   */
  constructor(
    readonly eventData: EventData,
    readonly partitionKey?: string,
  ) {}
}
