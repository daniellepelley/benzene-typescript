/**
 * Port of Benzene.Aws.Lambda.EventBridge.DependencyInjectionExtensions (C# extension methods -> free
 * functions).
 */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMediaFormatNegotiator,
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  IRequestEnricher,
  IRequestMapper,
  ITransportInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { EventBridgeContext } from './EventBridgeContext';
import { EventBridgeMessageBodyGetter } from './EventBridgeMessageBodyGetter';
import { EventBridgeMessageHeadersGetter } from './EventBridgeMessageHeadersGetter';
import { EventBridgeMessageMessageHandlerResultSetter } from './EventBridgeMessageMessageHandlerResultSetter';
import { EventBridgeMessageTopicGetter } from './EventBridgeMessageTopicGetter';

/**
 * Registers the services required to route EventBridge events to message handlers: topic (`detail-type`) /
 * body (`detail`) / header extraction, request mapping, media-format negotiation, and an `"eventbridge"`
 * `ITransportInfo`. Called automatically by `useEventBridge`.
 *
 * DI-under-erasure notes (same pattern as the ported `addSns`/`addS3`): C# closed-generic registrations
 * like `AddScoped<IMessageBodyGetter<EventBridgeContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (the erased `<EventBridgeContext>` is closed here). Where C# uses
 * `TryAddScoped` the port uses `tryAddScoped`; `AddScoped`/`AddSingleton` become non-`try` factory
 * registrations so these EventBridge getters win over any generic defaults.
 */
export function addEventBridge(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);

  services.addScopedFactory(
    IMessageTopicGetter,
    () => new EventBridgeMessageTopicGetter() as IMessageTopicGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new EventBridgeMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new EventBridgeMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new EventBridgeMessageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<EventBridgeContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo('eventbridge'));
  return services;
}
