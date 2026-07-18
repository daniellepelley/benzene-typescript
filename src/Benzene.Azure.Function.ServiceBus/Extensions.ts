/** Port of Benzene.Azure.Function.ServiceBus.Extensions + the UseServiceBus wiring from DependencyInjectionExtensions. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp, IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { addServiceBus } from './DependencyInjectionExtensions';
import { ServiceBusApplication } from './ServiceBusApplication';
import { ServiceBusContext } from './ServiceBusContext';
import { ServiceBusOptions } from './ServiceBusOptions';

/**
 * Adds a Service Bus entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseServiceBus(this
 * IAzureFunctionAppBuilder, ...)` (co-located here with the dispatch helper, mirroring the AWS `useSqs`
 * layout). Registers the Service Bus services, builds the per-message `ServiceBusContext` pipeline from
 * `action`, then adds a `ServiceBusApplication` over it.
 *
 * DEFERRED: the C# `UseServiceBus(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not
 * ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction.
 *
 * @param app The Azure Function app builder to add Service Bus handling to.
 * @param action Configures the Service Bus middleware pipeline.
 * @param configure Optionally configures `ServiceBusOptions` (e.g. `catchExceptions` / `raiseOnFailureStatus`).
 */
export function useServiceBus(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<ServiceBusContext>,
  configure?: (options: ServiceBusOptions) => void,
): IAzureFunctionAppBuilder {
  app.register((x) => addServiceBus(x));
  const pipeline = app.create<ServiceBusContext>();
  action(pipeline);
  const options = new ServiceBusOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new ServiceBusApplication(pipeline.build(), serviceResolverFactory, options),
  );
  return app;
}

/**
 * Dispatches Service Bus messages to the Azure Function app's Service Bus entry point application.
 * Port of C# `Extensions.HandleServiceBusMessages(this IAzureFunctionApp, params
 * ServiceBusReceivedMessage[])`. C# `params` maps to a TypeScript rest parameter; a single message for
 * a non-batched trigger, or a batch for one configured with `isBatched: true`.
 *
 * @param source The built Azure Function app to dispatch to.
 * @param messages The Service Bus messages to handle.
 */
export function handleServiceBusMessages(
  source: IAzureFunctionApp,
  ...messages: ServiceBusReceivedMessage[]
): Promise<void> {
  return source.handleAsync(messages);
}
