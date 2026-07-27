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
import { RabbitMqConstants } from './RabbitMqConstants';
import { RabbitMqContext } from './RabbitMqMessage/RabbitMqContext';
import { RabbitMqMessageBodyGetter } from './RabbitMqMessage/RabbitMqMessageBodyGetter';
import { RabbitMqMessageHandlerResultSetter } from './RabbitMqMessage/RabbitMqMessageHandlerResultSetter';
import { RabbitMqMessageHeadersGetter } from './RabbitMqMessage/RabbitMqMessageHeadersGetter';
import { RabbitMqMessageTopicGetter } from './RabbitMqMessage/RabbitMqMessageTopicGetter';

/**
 * Port of Benzene.RabbitMq.DependencyInjectionExtensions (C# extension method `AddRabbitMq` -> free
 * function).
 *
 * Registers everything `useMessageHandlers` resolves per {@link RabbitMqContext}: the topic getter (the
 * topic header, falling back to the AMQP routing key, wrapped in a `PresetTopicMessageTopicGetter` so
 * `.usePresetTopic(...)` works), the header message-version getter, the headers/body getters, the result
 * setter, media-format negotiation, the request mapper, and a `"rabbitmq"` `ITransportInfo`. Called
 * automatically by `useRabbitMq`. Mirrors `addServiceBusConsumer`'s registration completeness.
 *
 * @param services The service container to register services with.
 * @param topicHeaderKey The message-property header the topic is read from (see
 *   {@link RabbitMqConfig.topicHeaderKey}). Defaults to {@link RabbitMqConstants.DefaultTopicHeader}.
 * @returns The service container, for chaining.
 */
export function addRabbitMqConsumer(
  services: IBenzeneServiceContainer,
  topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<RabbitMqContext>(
        new RabbitMqMessageTopicGetter(topicHeaderKey),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<RabbitMqContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new RabbitMqMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new RabbitMqMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new RabbitMqMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<RabbitMqContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.RabbitMq));

  return services;
}
