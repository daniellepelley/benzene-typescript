/**
 * Port of Benzene.Aws.Lambda.Kafka.DependencyInjectionExtensions (C# extension methods -> free functions).
 */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzenejs/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  ITransportInfo,
  TransportNames,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { JsonSerializer, TransportInfo, tryAddHeaderMessageVersionGetter } from '@benzenejs/core-message-handlers';
import { KafkaContext } from './KafkaContext';
import { KafkaMessageBodyGetter } from './KafkaMessageBodyGetter';
import { KafkaMessageHeadersGetter } from './KafkaMessageHeadersGetter';
import { KafkaMessageMessageHandlerResultSetter } from './KafkaMessageMessageHandlerResultSetter';
import { KafkaMessageTopicGetter } from './KafkaMessageTopicGetter';

/**
 * Registers the services required to process Kafka records: the boundary getters (topic/body/header), the
 * result setter, and a `"kafka"` `ITransportInfo`. Called automatically by `useKafka`.
 *
 * FAITHFUL to the C# `AddKafka`: unlike `addS3`/`addSns`, this does NOT register media-format negotiation or
 * an `IRequestMapper` — those come from the request/response defaults registered by `addContextItems` (which
 * `useMessageHandlers` calls). The boundary getters are registered under each interface's shared `<unknown>`
 * token (the erased `<KafkaContext>` is closed here); `JsonSerializer` is `tryAdd`-ed, matching C#
 * `TryAddScoped<JsonSerializer>`.
 *
 * `topicHeaderKey` is the record header the topic is read from (default `topic`), falling back to the
 * Kafka topic when the header is absent (transport-bindings.md, Kafka); the header is consumed - the
 * topic, not a header - and a `benzene-version` header selects the handler version
 * (`tryAddHeaderMessageVersionGetter`, as .NET's `TryAddHeaderMessageVersionGetter`).
 */
export function addKafka(
  services: IBenzeneServiceContainer,
  topicHeaderKey: string = KafkaMessageTopicGetter.DefaultTopicHeader,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new KafkaMessageTopicGetter(topicHeaderKey) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new KafkaMessageHeadersGetter(topicHeaderKey) as IMessageHeadersGetter<unknown>,
  );
  tryAddHeaderMessageVersionGetter<KafkaContext>(services);
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new KafkaMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new KafkaMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Kafka));
  return services;
}
