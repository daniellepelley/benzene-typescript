/** Port of Benzene.Kafka.Core.Kafka.DependencyInjectionExtensions (C# extension method -> free function). */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { KafkaSendMessageBodyGetter } from './KafkaMessageBodyGetter';
import { KafkaSendMessageHeadersGetter } from './KafkaMessageHeadersGetter';
import { KafkaSendMessageTopicGetter } from './KafkaSendMessageTopicGetter';

/**
 * Registers the send-side boundary getters that operate on a `KafkaSendMessageContext` — the port of
 * C# `AddSendKafka`.
 *
 * PORT NOTE: C# registers each getter under its closed generic interface
 * (`IMessageTopicGetter<KafkaSendMessageContext>`, ...). TypeScript service tokens are non-generic, so
 * these register under the shared `IMessageTopicGetter`/`IMessageHeadersGetter`/`IMessageBodyGetter`
 * tokens — the same tokens the inbound `addKafkaConsumer` uses. Register the send getters in the
 * container/scope driving the outbound produce pipeline, distinct from the inbound consumer's, exactly
 * as Benzene keeps outbound and inbound pipelines separate.
 */
export function addSendKafka(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  services.addScopedFactory(
    IMessageTopicGetter,
    () => new KafkaSendMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new KafkaSendMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new KafkaSendMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );

  return services;
}
