import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  addHeaderMessageVersionGetter,
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { EventHubConsumerContext } from './EventHubConsumerContext';
import { EventHubConsumerMessageBodyGetter } from './EventHubConsumerMessageBodyGetter';
import { EventHubConsumerMessageHandlerResultSetter } from './EventHubConsumerMessageHandlerResultSetter';
import { EventHubConsumerMessageHeadersGetter } from './EventHubConsumerMessageHeadersGetter';
import { EventHubConsumerMessageTopicGetter } from './EventHubConsumerMessageTopicGetter';

/**
 * Port of Benzene.Azure.EventHub.DependencyInjectionExtensions (C# extension methods -> free functions).
 *
 * Registers the services required to process consumed events with the standalone (non-Functions)
 * consumer: the four boundary getters, the header message-version getter, media-format negotiation, the
 * request mapper, and an `"event-hub"` `ITransportInfo`. Called automatically by `useEventHub`. Mirrors
 * `addSqsConsumer`/`addServiceBusConsumer`'s registration completeness (everything `useMessageHandlers`
 * resolves per context type).
 */
export function addEventHubConsumer(
  services: IBenzeneServiceContainer,
  topicPropertyKey: string = EventHubConsumerMessageTopicGetter.DefaultTopicProperty,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<EventHubConsumerContext>(
        new EventHubConsumerMessageTopicGetter(topicPropertyKey),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<EventHubConsumerContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new EventHubConsumerMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new EventHubConsumerMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new EventHubConsumerMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<EventHubConsumerContext>(services);

  services.addScopedFactory(
    IRequestMapper,
    (resolver) =>
      new MultiSerializerOptionsRequestMapper(
        resolver.getService(IMediaFormatNegotiator),
        resolver,
        resolver.getService(IMessageBodyGetter),
        resolver.getServices(IRequestEnricher),
      ) as IRequestMapper<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.EventHub));

  return services;
}
