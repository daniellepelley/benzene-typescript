/** Port of Benzene.Azure.Function.EventHub.Function.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { EventHubApplication } from './EventHubApplication';
import { EventHubContext } from './EventHubContext';

/**
 * Adds an Event Hub entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseEventHub(this
 * IAzureFunctionAppBuilder, ...)`.
 *
 * FAITHFUL to the C#: unlike `useServiceBus`/`useKafka`, this registers NO transport getters (there is no
 * `AddEventHub`) — the Event Hub package routes via `useBenzeneMessage` (a `BenzeneMessageEventHubHandler`
 * middleware), whose inner pipeline calls `addBenzeneMessage`. It simply builds the per-event
 * `EventHubContext` pipeline from `action` and adds an `EventHubApplication` over it.
 *
 * DEFERRED: the C# `UseEventHub(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not ported
 * — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same deferral as
 * the ported `useServiceBus`).
 *
 * @param app The Azure Function app builder to add Event Hub handling to.
 * @param action Configures the Event Hub middleware pipeline.
 */
export function useEventHub(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<EventHubContext>,
): IAzureFunctionAppBuilder {
  const pipeline = app.create<EventHubContext>();
  action(pipeline);
  app.add(
    (serviceResolverFactory) => new EventHubApplication(pipeline.build(), serviceResolverFactory),
  );
  return app;
}
