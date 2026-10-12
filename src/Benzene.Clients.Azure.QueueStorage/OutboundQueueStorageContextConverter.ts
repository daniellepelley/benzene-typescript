/** Port of Benzene.Clients.Azure.QueueStorage.OutboundQueueStorageContextConverter. */
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { BenzeneMessageRequest } from '@benzenejs/core-messages';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneResult, failedSendResult } from '@benzenejs/results';
import { QueueStorageSendMessageContext } from './QueueStorageSendMessageContext';

/**
 * Converts an outbound `OutboundContext` (an `OutboundRoutingBuilder.route` pipeline) into a
 * `QueueStorageSendMessageContext`, so a topic routed here is sent via Azure Queue Storage. The
 * `OutboundContext` counterpart of the (deferred) generic `QueueStorageContextConverter<T>`.
 *
 * Queue Storage has no per-message properties, so the topic + headers + serialized body are packed into
 * a `BenzeneMessageRequest` envelope which is itself serialized as the queue message text — the same
 * envelope the Benzene queue-storage ingress rehydrates. The mapped response is always an accepted
 * `VoidResult`-typed `IBenzeneResult` — a topic routed here must be sent via
 * `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>`.
 */
export class OutboundQueueStorageContextConverter
  implements IContextConverter<OutboundContext, QueueStorageSendMessageContext>
{
  private readonly serializer: ISerializer;

  constructor(serializer?: ISerializer) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<QueueStorageSendMessageContext> {
    const envelope = new BenzeneMessageRequest();
    envelope.topic = contextIn.topic;
    envelope.headers = contextIn.headers;
    envelope.body = this.serializer.serialize(contextIn.request);

    return Promise.resolve(new QueueStorageSendMessageContext(this.serializer.serialize(envelope)));
  }

  mapResponseAsync(contextIn: OutboundContext, contextOut: QueueStorageSendMessageContext): Promise<void> {
    // The SDK call rejected before the broker accepted the message (transport-bindings §1): a result, not
    // an exception.
    if (contextOut.transportFailure !== undefined) {
      contextIn.response = failedSendResult<VoidResult>(contextOut.transportFailure);
      return Promise.resolve();
    }
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}
