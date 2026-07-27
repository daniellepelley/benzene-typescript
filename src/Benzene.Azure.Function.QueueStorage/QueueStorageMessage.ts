/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessage. */

/**
 * Benzene's own model of a Queue Storage message — dependency-free, mirroring how the .NET package
 * models it (and how `@benzene/aws-lambda-kinesis` models its Lambda event). The `@azure/functions`
 * v4 `storageQueue` trigger most commonly delivers the message as a `string` (its text), which maps
 * to `messageText` alone; a caller who binds the richer payload can also supply the metadata
 * properties.
 *
 * MESSAGE-TYPE ADAPTATION: unlike the Service Bus / Event Hub packages (which depend on the SDK's
 * `ServiceBusReceivedMessage` / `ReceivedEventData`), `@azure/functions` exposes no dedicated
 * queue-message type — the trigger hands the callback the raw string — so, exactly as in the .NET
 * original, the port keeps a bespoke dependency-free model rather than inventing an SDK dependency.
 */
export class QueueStorageMessage {
  /** The message text (the queue message's body). */
  readonly messageText: string;

  /** The message id, when bound from the richer queue payload; otherwise `undefined`. */
  readonly messageId?: string;

  /**
   * How many times the message has been dequeued, when bound from the richer queue payload;
   * otherwise `undefined`. Useful for poison-message handling before the host's own
   * `maxDequeueCount` moves it to the `<queue>-poison` queue.
   */
  readonly dequeueCount?: number;

  /** When the message was enqueued, when bound from the richer queue payload; otherwise `undefined`. */
  readonly insertedOn?: Date;

  /**
   * @param messageText The message text.
   * @param metadata Optional metadata carried across when bound from the richer queue payload.
   */
  constructor(
    messageText: string,
    metadata?: { messageId?: string; dequeueCount?: number; insertedOn?: Date },
  ) {
    this.messageText = messageText;
    this.messageId = metadata?.messageId;
    this.dequeueCount = metadata?.dequeueCount;
    this.insertedOn = metadata?.insertedOn;
  }
}
