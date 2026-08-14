import { IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { BatchSendResult } from './BatchSendResult';

/**
 * Sends a collection of messages to a transport using the provider's native *batch* primitive (SNS
 * `PublishBatch`, SQS `SendMessageBatch`, EventBridge `PutEvents`, an Event Hub `EventDataBatch`, …)
 * instead of one call per message. A separate interface from `IBenzeneMessageClient` so the single-send
 * path is unchanged; a client can implement either or both. Batch sending is fire-and-forget with per-entry
 * acknowledgement — there is no typed response, only which entries failed.
 * Port of Benzene.Clients.IBenzeneBatchMessageClient (its `IDisposable` maps to an optional `dispose`).
 */
export interface IBenzeneBatchMessageClient {
  /**
   * Sends every request in `requests`, chunking to the provider's per-batch limit and issuing one batch
   * call per chunk.
   *
   * @typeParam TRequest The message payload type.
   * @param requests The messages to send, in order.
   * @returns A `BatchSendResult` listing the entries that failed (by their index in `requests`), so the
   *   caller can retry just those. Empty when all succeeded.
   */
  sendBatchAsync<TRequest>(requests: readonly IBenzeneClientRequest<TRequest>[]): Promise<BatchSendResult>;

  /** Port of C# `IDisposable.Dispose()`; optional, since most batch clients hold no disposable resources. */
  dispose?(): void;
}
