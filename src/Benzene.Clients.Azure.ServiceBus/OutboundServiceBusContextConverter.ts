/** Port of Benzene.Clients.Azure.ServiceBus.OutboundServiceBusContextConverter. */
import { ServiceBusMessage } from '@azure/service-bus';
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { OutboundContext } from '@benzenejs/clients';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { ServiceBusSendMessageContext } from './ServiceBusSendMessageContext';

/**
 * Converts an outbound `OutboundContext` (an `OutboundRoutingBuilder.route` pipeline) into a
 * `ServiceBusSendMessageContext`, so a topic routed here is sent via Azure Service Bus. The
 * `OutboundContext` counterpart of the (deferred) generic `ServiceBusContextConverter<T>`.
 *
 * Service Bus has no request/response semantics beyond a send acknowledgement, so the mapped response
 * is always an accepted `VoidResult`-typed `IBenzeneResult` — a topic routed here must be sent via
 * `IBenzeneMessageSender.sendAsync<TRequest, VoidResult>`. The serialized message becomes the message
 * body; the topic + per-call headers become `applicationProperties` (the same properties the Service
 * Bus ingress reads to route and rehydrate headers).
 */
export class OutboundServiceBusContextConverter
  implements IContextConverter<OutboundContext, ServiceBusSendMessageContext>
{
  /**
   * The default application-property key the topic is written to. A single default, not a hard-coded
   * value — pass a different key to interoperate with a consumer that routes on another application
   * property; keep it in sync with the consumer's property key.
   */
  static readonly DefaultTopicProperty = 'topic';

  private readonly serializer: ISerializer;

  constructor(
    private readonly topicPropertyKey: string = OutboundServiceBusContextConverter.DefaultTopicProperty,
    serializer?: ISerializer,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
  }

  createRequestAsync(contextIn: OutboundContext): Promise<ServiceBusSendMessageContext> {
    const applicationProperties: Record<string, string> = {};
    for (const [key, value] of Object.entries(contextIn.headers)) {
      applicationProperties[key] = value;
    }
    applicationProperties[this.topicPropertyKey] = contextIn.topic;

    const message: ServiceBusMessage = {
      body: this.serializer.serialize(contextIn.request),
      applicationProperties,
    };
    const contextOut = new ServiceBusSendMessageContext(message);
    contextOut.signal = contextIn.signal;
    return Promise.resolve(contextOut);
  }

  mapResponseAsync(contextIn: OutboundContext, _contextOut: ServiceBusSendMessageContext): Promise<void> {
    contextIn.response = BenzeneResult.accepted<VoidResult>(new VoidResult());
    return Promise.resolve();
  }
}
