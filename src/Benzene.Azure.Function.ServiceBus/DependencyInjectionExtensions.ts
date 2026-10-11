/** Port of Benzene.Azure.Function.ServiceBus.DependencyInjectionExtensions (C# extension methods -> free functions). */
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
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
  tryAddHeaderMessageVersionGetter,
} from '@benzenejs/core-message-handlers';
import { ServiceBusContext } from './ServiceBusContext';
import { ServiceBusMessageBodyGetter } from './ServiceBusMessageBodyGetter';
import { ServiceBusMessageHeadersGetter } from './ServiceBusMessageHeadersGetter';
import { ServiceBusMessageMessageHandlerResultSetter } from './ServiceBusMessageMessageHandlerResultSetter';
import { ServiceBusMessageTopicGetter } from './ServiceBusMessageTopicGetter';

/**
 * Registers the services required to process Service Bus-triggered messages: request mapping, the
 * Service Bus boundary getters and result setter, media-format negotiation, and a `"service-bus"`
 * `ITransportInfo`. Called automatically by `useServiceBus`; you don't normally call it directly.
 *
 * C# name: `AddAzureServiceBus`. Renamed `addServiceBus` here to match the package's public surface.
 *
 * DI-under-erasure notes (same pattern as the ported `addSqs`): C# closed-generic registrations like
 * `AddScoped<IMessageBodyGetter<ServiceBusContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (one context type per pipeline, so the erased
 * `<ServiceBusContext>` is closed here). Where C# uses `TryAddScoped` the port uses `tryAddScoped`;
 * `AddScoped`/`AddSingleton` become the non-`try` factory registrations, so these Service Bus getters
 * win over any generic defaults registered later.
 *
 * `topicPropertyKey` is the application property the topic is read from (default `topic`, wire-contracts.md §2); it is
 * consumed - the topic, not a header - and a `benzene-version` application property selects the handler version
 * (`tryAddHeaderMessageVersionGetter`, as .NET's `TryAddHeaderMessageVersionGetter`).
 */
export function addServiceBus(
  services: IBenzeneServiceContainer,
  topicPropertyKey: string = ServiceBusMessageTopicGetter.DefaultTopicProperty,
): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<ServiceBusContext>(
        new ServiceBusMessageTopicGetter(topicPropertyKey),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new ServiceBusMessageHeadersGetter(topicPropertyKey) as IMessageHeadersGetter<unknown>,
  );
  tryAddHeaderMessageVersionGetter<ServiceBusContext>(services);
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new ServiceBusMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new ServiceBusMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<ServiceBusContext>(services);

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
