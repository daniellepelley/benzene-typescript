/** Port of Benzene.Azure.Function.Kafka.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { IBenzeneServiceContainer, tryAddScoped } from '@benzene/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  ITransportInfo,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { JsonSerializer, TransportInfo } from '@benzene/core-message-handlers';
import { KafkaApplication } from './KafkaApplication';
import { KafkaContext } from './KafkaContext';
import { KafkaMessageBodyGetter } from './KafkaMessageBodyGetter';
import { KafkaMessageHeadersGetter } from './KafkaMessageHeadersGetter';
import { KafkaMessageMessageHandlerResultSetter } from './KafkaMessageMessageHandlerResultSetter';
import { KafkaMessageTopicGetter } from './KafkaMessageTopicGetter';
import { KafkaOptions } from './KafkaOptions';

/**
 * Registers the services required to process Kafka-triggered messages: the Kafka boundary getters
 * (topic/body/header), the result setter, and a `"kafka"` `ITransportInfo`. Called automatically by
 * `useKafka`; you don't normally call it directly.
 *
 * C# name: `AddAzureKafka`. Renamed `addKafka` here to match the package's public surface (and the AWS
 * `addKafka`). FAITHFUL to the C#: unlike `addServiceBus`, this does NOT register media-format
 * negotiation, an `IRequestMapper`, or `PresetTopicHolder` — Kafka records carry their own native topic,
 * and the request/response mapping comes from `addContextItems` (which `useMessageHandlers` calls).
 *
 * DI-under-erasure notes (same pattern as the ported AWS `addKafka`): C# closed-generic registrations
 * like `AddScoped<IMessageBodyGetter<KafkaContext>, ...>` become factory registrations under each
 * interface's shared `<unknown>` token (one context type per pipeline, so the erased `<KafkaContext>` is
 * closed here). Where C# uses `TryAddScoped` the port uses `tryAddScoped`; `AddScoped`/`AddSingleton`
 * become the non-`try` factory registrations, so these Kafka getters win over any generic defaults.
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

/**
 * Adds a Kafka entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseKafka(this IAzureFunctionAppBuilder,
 * ...)`. Registers the Kafka services, builds the per-record `KafkaContext` pipeline from `action`, then
 * adds a `KafkaApplication` over it.
 *
 * DEFERRED: the C# `UseKafka(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not ported —
 * it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same deferral as
 * the ported `useServiceBus`).
 *
 * @param app The Azure Function app builder to add Kafka handling to.
 * @param action Configures the Kafka middleware pipeline.
 * @param configure Optionally configures `KafkaOptions` (e.g. `catchExceptions` / `raiseOnFailureStatus`).
 */
export function useKafka(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<KafkaContext>,
  configure?: (options: KafkaOptions) => void,
): IAzureFunctionAppBuilder {
  app.register((x) => addKafka(x));
  const pipeline = app.create<KafkaContext>();
  action(pipeline);
  const options = new KafkaOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new KafkaApplication(pipeline.build(), serviceResolverFactory, options),
  );
  return app;
}
