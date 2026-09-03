/** Port of Benzene.Azure.Function.EventHub.Function.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { IAzureFunctionAppBuilder } from '@benzenejs/azure-function-core';
import { EventHubApplication } from './EventHubApplication';
import { EventHubContext } from './EventHubContext';
import { EventHubOptions } from './EventHubOptions';

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
 * @param configure Optionally configures `EventHubOptions` (e.g. `catchExceptions` /
 *   `raiseOnFailureStatus`) — the defaults are safe-by-default on the failure-result axis
 *   (`raiseOnFailureStatus` on, `catchExceptions` off).
 */
export function useEventHub(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<EventHubContext>,
  configure?: (options: EventHubOptions) => void,
): IAzureFunctionAppBuilder {
  const pipeline = app.create<EventHubContext>();
  action(pipeline);
  const options = new EventHubOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new EventHubApplication(pipeline.build(), serviceResolverFactory, options),
  );
  return app;
}
