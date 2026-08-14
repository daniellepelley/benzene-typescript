/** Port of Benzene.Azure.Function.EventGrid.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzenejs/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  ITransportInfo,
  TransportNames,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import {
  addHeaderMessageVersionGetter,
  JsonSerializer,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzenejs/core-message-handlers';
import { IAzureFunctionAppBuilder } from '@benzenejs/azure-function-core';
import { EventGridApplication } from './EventGridApplication';
import { EventGridContext } from './EventGridContext';
import { EventGridMessageBodyGetter } from './EventGridMessageBodyGetter';
import { EventGridMessageHandlerResultSetter } from './EventGridMessageHandlerResultSetter';
import { EventGridMessageHeadersGetter } from './EventGridMessageHeadersGetter';
import { EventGridMessageTopicGetter } from './EventGridMessageTopicGetter';
import { EventGridOptions } from './EventGridOptions';

/**
 * Registers the services required to process Event Grid-triggered events: the preset-wrapped topic
 * getter (routing by `eventType`), the header message-version getter, the envelope-headers /
 * `data`-payload body getters, the result setter, and an `"event-grid"` `ITransportInfo`. Called
 * automatically by `useEventGrid`; you don't normally call it directly.
 *
 * C# name: `AddAzureEventGrid`. Renamed `addEventGrid` here to match the package's public surface.
 * Follows the routed-consumer DI shape: C# closed-generic registrations like
 * `AddScoped<IMessageBodyGetter<EventGridContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (one context type per pipeline, so the erased `<EventGridContext>`
 * is closed here). Where C# uses `TryAddScoped` the port uses `tryAddScoped`. Like the C# original (and
 * `addQueueStorage`/`addKafka`), NO request mapper is registered here — the request/response mapping
 * comes from `addContextItems`, which `useMessageHandlers` calls.
 */
export function addEventGrid(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  services.addScopedFactory(
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<EventGridContext>(
        new EventGridMessageTopicGetter(),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<EventGridContext>(services);
  services.addScopedFactory(
    IMessageHeadersGetter,
    () => new EventGridMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageBodyGetter,
    () => new EventGridMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  services.addScopedFactory(
    IMessageHandlerResultSetter,
    () => new EventGridMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.EventGrid));
  return services;
}

/**
 * Adds an Event Grid entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseEventGrid(this
 * IAzureFunctionAppBuilder, ...)`. Events route by their event type (`eventType` in the Event Grid
 * schema, `type` in CloudEvents) — declare message handlers for those topics, or override with
 * `usePresetTopic(...)`.
 *
 * DEFERRED: the C# `UseEventGrid(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not
 * ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same
 * deferral as the ported `useServiceBus`). The C# `name` discriminator (for more than one Event Grid
 * function) is also not ported — the ported `IAzureFunctionAppBuilder.add` takes no name, matching the
 * ported `useServiceBus`/`useQueueStorage`.
 *
 * @param app The Azure Function app builder to add Event Grid handling to.
 * @param action Configures the Event Grid middleware pipeline.
 * @param configure Optionally configures `EventGridOptions` (e.g. `raiseOnFailureStatus` /
 *   `catchExceptions` / `maxDegreeOfParallelism`).
 */
export function useEventGrid(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<EventGridContext>,
  configure?: (options: EventGridOptions) => void,
): IAzureFunctionAppBuilder {
  app.register((x) => addEventGrid(x));
  const pipeline = app.create<EventGridContext>();
  action(pipeline);
  const options = new EventGridOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new EventGridApplication(pipeline.build(), serviceResolverFactory, options),
  );
  return app;
}
