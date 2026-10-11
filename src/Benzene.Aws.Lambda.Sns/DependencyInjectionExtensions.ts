/**
 * Port of Benzene.Aws.Lambda.Sns.DependencyInjectionExtensions (C# extension methods -> free functions).
 */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzenejs/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
  TransportNames,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import {
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  TransportInfo,
  tryAddHeaderMessageVersionGetter,
} from '@benzenejs/core-message-handlers';
import { SnsMessageBodyGetter } from './SnsMessageBodyGetter';
import { SnsMessageHeadersGetter } from './SnsMessageHeadersGetter';
import { SnsMessageMessageHandlerResultSetter } from './SnsMessageMessageHandlerResultSetter';
import { SnsMessageTopicGetter } from './SnsMessageTopicGetter';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Registers the services required to process SNS notifications: request mapping, the SNS boundary getters
 * and result setter, media-format negotiation, and a `"sns"` `ITransportInfo`. Called automatically by
 * `useSns`.
 *
 * DI-under-erasure notes (same pattern as the ported `addSqs`): C# closed-generic registrations like
 * `AddScoped<IMessageBodyGetter<SnsRecordContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (one context type per pipeline, so the erased `<SnsRecordContext>`
 * is closed here). Where C# uses `TryAddScoped` the port uses `tryAddScoped`; `AddScoped`/`AddSingleton`
 * become the non-`try` factory registrations, so these SNS getters win over any generic defaults.
 *
 * TOPIC GETTER: matching the C# `AddSns`, the topic getter is registered DIRECTLY (no
 * `PresetTopicMessageTopicGetter`/`PresetTopicHolder` wrapping — that is an SQS/ServiceBus concern). SNS
 * derives the topic from the `topic` message attribute set by a Benzene publisher.
 *
 * `topicAttributeKey` is the message attribute the topic is read from (default `topic`, wire-contracts.md §2); it is
 * consumed - the topic, not a header - and a `benzene-version` message attribute selects the handler version
 * (`tryAddHeaderMessageVersionGetter`, as .NET's `TryAddHeaderMessageVersionGetter`).
 */
export function addSns(
  services: IBenzeneServiceContainer,
  topicAttributeKey: string = SnsMessageTopicGetter.DefaultTopicAttribute,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new SnsMessageTopicGetter(topicAttributeKey) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new SnsMessageHeadersGetter(topicAttributeKey) as IMessageHeadersGetter<unknown>,
  );
  tryAddHeaderMessageVersionGetter<SnsRecordContext>(services);
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new SnsMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new SnsMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<SnsRecordContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Sns));
  return services;
}
