/** Port of Benzene.Azure.Function.Timer.DependencyInjectionExtensions (C# extension methods -> free functions). */
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
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import {
  addHeaderMessageVersionGetter,
  addMediaFormatNegotiation,
  JsonSerializer,
  MultiSerializerOptionsRequestMapper,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { TimerApplication } from './TimerApplication';
import { TimerContext } from './TimerContext';
import {
  TimerMessageBodyGetter,
  TimerMessageHandlerResultSetter,
  TimerMessageHeadersGetter,
  TimerMessageTopicGetter,
} from './TimerMessageMappers';

/**
 * Registers the services required to process timer-triggered ticks: the preset-wrapped (null) topic
 * getter, the header message-version getter, the empty-headers / serialized-`TimerTriggerInfo` body
 * getters, the result setter, media-format negotiation + request mapper, and a `"timer"`
 * `ITransportInfo`. Called automatically by `useTimerTrigger`; you don't normally call it directly.
 *
 * C# name: `AddAzureTimer`, kept here. Follows the ported queue-consumer DI shape (`addQueueStorage` /
 * `addSqsConsumer`): the TS port registers `addMediaFormatNegotiation` + `MultiSerializerOptionsRequestMapper`
 * so the serialized-`TimerTriggerInfo` body deserializes into the handler's request type on the
 * preset-topic (`usePresetTopic(...)` + `useMessageHandlers(...)`) path. The body getter is
 * ctor-injected with the resolved `JsonSerializer`, exactly as C#.
 */
export function addAzureTimer(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<TimerContext>(
        new TimerMessageTopicGetter(),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<TimerContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new TimerMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    (resolver) =>
      new TimerMessageBodyGetter(resolver.getService(JsonSerializer)) as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new TimerMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  addMediaFormatNegotiation<TimerContext>(services);

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

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.Timer));
  return services;
}

/**
 * Adds a timer entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseTimerTrigger(this
 * IAzureFunctionAppBuilder, ...)`. A tick carries no message, so either consume it directly with
 * `useTick(...)`, or — to run a scheduled job through the same message handlers as any other transport
 * — give the pipeline the job's topic: `usePresetTopic(timer, "nightly-cleanup")` + `useMessageHandlers`.
 *
 * NAMED `useTimerTrigger` (not `useTimer`) to mirror the C#, which avoids colliding with
 * `Benzene.Diagnostics`'s timing-middleware `UseTimer`.
 *
 * DEFERRED: the C# `UseTimerTrigger(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not
 * ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same
 * deferral as the ported `useServiceBus`).
 *
 * @param app The Azure Function app builder to add timer handling to.
 * @param action Configures the timer middleware pipeline.
 */
export function useTimerTrigger(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<TimerContext>,
): IAzureFunctionAppBuilder {
  app.register((x) => addAzureTimer(x));
  const pipeline = app.create<TimerContext>();
  action(pipeline);
  app.add(
    (serviceResolverFactory) => new TimerApplication(pipeline.build(), serviceResolverFactory),
  );
  return app;
}
