/**
 * Port of Benzene.Aws.Lambda.Kafka.DependencyInjectionExtensions (C# extension methods -> free functions).
 */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  ITransportInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { JsonSerializer, TransportInfo } from '@benzene/core-message-handlers';
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
 */
export function addKafka(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new KafkaMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
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
    () => new KafkaMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('kafka'));
  return services;
}
