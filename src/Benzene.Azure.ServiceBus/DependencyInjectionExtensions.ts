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
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';
import { ServiceBusConsumerMessageBodyGetter } from './ServiceBusConsumerMessageBodyGetter';
import { ServiceBusConsumerMessageHandlerResultSetter } from './ServiceBusConsumerMessageHandlerResultSetter';
import { ServiceBusConsumerMessageHeadersGetter } from './ServiceBusConsumerMessageHeadersGetter';
import { ServiceBusConsumerMessageTopicGetter } from './ServiceBusConsumerMessageTopicGetter';
import { ServiceBusSettlementHolder } from './ServiceBusSettlementHolder';

/**
 * Port of Benzene.Azure.ServiceBus.DependencyInjectionExtensions (C# extension methods -> free
 * functions).
 *
 * Registers the services required to process consumed Service Bus messages with the standalone
 * (non-Functions) consumer: the four boundary getters, the header message-version getter,
 * media-format negotiation, the request mapper, a `"service-bus"` `ITransportInfo`, and the scoped
 * `ServiceBusSettlementHolder` a handler can request an explicit settlement on. Called automatically
 * by `useServiceBus`. Mirrors `addSqsConsumer`'s registration completeness (everything
 * `useMessageHandlers` resolves per context type).
 */
export function addServiceBusConsumer(
  services: IBenzeneServiceContainer,
  topicPropertyKey: string = ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);
  // Scoped per message, so a handler can request an explicit settlement (dead-letter/defer); the
  // worker reads it after the pipeline. Default (no override) unless the handler sets it.
  tryAddScoped(services, ServiceBusSettlementHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<ServiceBusConsumerContext>(
        new ServiceBusConsumerMessageTopicGetter(topicPropertyKey),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<ServiceBusConsumerContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new ServiceBusConsumerMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new ServiceBusConsumerMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new ServiceBusConsumerMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<ServiceBusConsumerContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.ServiceBus));

  return services;
}
