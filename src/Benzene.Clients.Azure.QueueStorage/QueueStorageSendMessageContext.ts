/** Port of Benzene.Clients.Azure.QueueStorage.QueueStorageSendMessageContext. */

/**
 * The middleware pipeline context for sending a single message to Azure Queue Storage. A queue message
 * is a plain string body — there is no properties/attributes bag on this transport (so the topic and
 * headers travel inside a serialized `BenzeneMessageRequest` envelope, built by the converter).
 */
export class QueueStorageSendMessageContext {
  /**
   * Whether the message was sent. Set by `QueueStorageClientMiddleware` once the send completes without
   * throwing. `QueueClient.sendMessage` returns a receipt with no meaningful payload for Benzene's
   * purposes, so a completed send is an acknowledgement only.
   */
  isSent = false;

  /**
   * The caller's abort signal for this send, if any — copied from `OutboundContext.signal` by the
   * converter and passed to `sendMessage` as `abortSignal`, so an aborted caller aborts the outbound
   * send instead of running it to completion.
   */
  signal?: AbortSignal;

  constructor(readonly messageText: string) {}
}
