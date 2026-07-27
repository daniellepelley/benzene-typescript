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
  TransportInfo,
} from '@benzene/core-message-handlers';
import { KafkaMessageBodyGetter } from './KafkaMessage/KafkaMessageBodyGetter';
import { KafkaMessageHandlerResultSetter } from './KafkaMessage/KafkaMessageHandlerResultSetter';
import { KafkaMessageHeadersGetter } from './KafkaMessage/KafkaMessageHeadersGetter';
import { KafkaMessageTopicGetter } from './KafkaMessage/KafkaMessageTopicGetter';
import { KafkaRecordContext } from './KafkaMessage/KafkaRecordContext';

/**
 * Port of Benzene.Kafka.Core.DependencyInjectionExtensions (C# extension method `AddKafka<TKey,TValue>`
 * -> free function).
 *
 * Registers the services required to process consumed Kafka records: the four boundary getters, the
 * header message-version getter, media-format negotiation, the request mapper, and a `"kafka"`
 * `ITransportInfo`. Called automatically by `useKafka`. Mirrors `addSqsConsumer`/`addEventHubConsumer`'s
 * registration completeness (everything `useMessageHandlers` resolves per context type).
 *
 * DIVERGENCE from `addSqsConsumer`/`addEventHubConsumer`: those wrap their topic getter in a
 * `PresetTopicMessageTopicGetter` because their transport has no native topic (it is read from a message
 * property, which can be absent). A Kafka record always carries its own topic, so — matching the C#
 * `AddKafka`, which registers `KafkaMessageTopicGetter` directly — this port registers the plain getter
 * with no preset-topic fallback.
 */
export function addKafkaConsumer(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new KafkaMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<KafkaRecordContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new KafkaMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new KafkaMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new KafkaMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<KafkaRecordContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Kafka));

  return services;
}
