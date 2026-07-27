/** Port of Benzene.Azure.Function.QueueStorage.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { IBenzeneServiceContainer, tryAddScoped, tryAddScopedFactory } from '@benzene/abstractions';
import {
  IMessageHandlerResultSetter,
  IMessageTopicGetter,
  ITransportInfo,
  TransportNames,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import {
  addHeaderMessageVersionGetter,
  JsonSerializer,
  PresetTopicHolder,
  PresetTopicMessageTopicGetter,
  TransportInfo,
} from '@benzene/core-message-handlers';
import { IAzureFunctionAppBuilder } from '@benzene/azure-function-core';
import { QueueStorageApplication } from './QueueStorageApplication';
import { QueueStorageContext } from './QueueStorageContext';
import { QueueStorageMessageBodyGetter } from './QueueStorageMessageBodyGetter';
import { QueueStorageMessageHandlerResultSetter } from './QueueStorageMessageHandlerResultSetter';
import { QueueStorageMessageHeadersGetter } from './QueueStorageMessageHeadersGetter';
import { QueueStorageMessageTopicGetter } from './QueueStorageMessageTopicGetter';
import { QueueStorageOptions } from './QueueStorageOptions';

/**
 * Registers the services required to process Queue Storage-triggered messages: the preset-wrapped
 * (null) topic getter, the header message-version getter, the empty-headers / text-body getters, the
 * result setter, and a `"queue-storage"` `ITransportInfo`. Called automatically by `useQueueStorage`;
 * you don't normally call it directly.
 *
 * C# name: `AddAzureQueueStorage`. Renamed `addQueueStorage`. Follows the `addKafka` shape (transport
 * getters only; the request/response mapping comes from `addContextItems`, which `useMessageHandlers`
 * calls) rather than adding its own request mapper.
 *
 * DI-UNDER-ERASURE (why `tryAdd`, unlike `addKafka`'s `addScoped`): QueueStorage is the only trigger that
 * hosts BOTH its own `QueueStorageContext` pipeline (the preset-topic path) AND an inner
 * `BenzeneMessageContext` pipeline (the envelope path, via `useBenzeneMessage`) in the SAME container.
 * C# keeps these apart with closed generics (`IMessageBodyGetter<QueueStorageContext>` vs
 * `<BenzeneMessageContext>`); TypeScript erases both to `IMessageBodyGetter<unknown>` — one shared token.
 * `useQueueStorage` therefore registers `addQueueStorage` AFTER the pipeline `action` runs, and these
 * getters use `tryAdd`: on the envelope path the inner `addBenzeneMessage` (run during `action`) has
 * already registered the `BenzeneMessage` getters/result-setter, so these `tryAdd` calls no-op and the
 * inner pipeline resolves the correct `BenzeneMessage` services; on the preset-topic path nothing
 * registered these four tokens, so the QueueStorage getters take effect. The outer envelope pipeline runs
 * only `BenzeneMessageQueueStorageHandler` and never resolves them, so the no-op is invisible there.
 */
export function addQueueStorage(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddScoped(services, JsonSerializer);
  tryAddScoped(services, PresetTopicHolder);

  tryAddScopedFactory(
    services,
    IMessageTopicGetter,
    (resolver) =>
      new PresetTopicMessageTopicGetter<QueueStorageContext>(
        new QueueStorageMessageTopicGetter(),
        resolver.getService(PresetTopicHolder),
      ) as IMessageTopicGetter<unknown>,
  );
  addHeaderMessageVersionGetter<QueueStorageContext>(services);
  tryAddScopedFactory(
    services,
    IMessageHeadersGetter,
    () => new QueueStorageMessageHeadersGetter() as IMessageHeadersGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageBodyGetter,
    () => new QueueStorageMessageBodyGetter() as IMessageBodyGetter<unknown>,
  );
  tryAddScopedFactory(
    services,
    IMessageHandlerResultSetter,
    () => new QueueStorageMessageHandlerResultSetter() as IMessageHandlerResultSetter<unknown>,
  );

  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.QueueStorage));
  return services;
}

/**
 * Adds a Queue Storage entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseQueueStorage(this
 * IAzureFunctionAppBuilder, ...)`. Builds the per-message `QueueStorageContext` pipeline from `action`,
 * registers the Queue Storage services (see `addQueueStorage` for why AFTER `action`), then adds a
 * `QueueStorageApplication` over it. Queue Storage messages carry no transport properties, so route them
 * either with a Benzene message envelope in the body (`useBenzeneMessage(...)`) or a fixed per-queue
 * topic (`usePresetTopic(...)` + `useMessageHandlers(...)`).
 *
 * DEFERRED: the C# `UseQueueStorage(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not
 * ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same
 * deferral as the ported `useServiceBus`). The C# `name` discriminator (for more than one
 * `[QueueTrigger]` function) is also not ported — the ported `IAzureFunctionAppBuilder.add` takes no
 * name, matching the ported `useServiceBus`/`useKafka`.
 *
 * @param app The Azure Function app builder to add Queue Storage handling to.
 * @param action Configures the Queue Storage middleware pipeline.
 * @param configure Optionally configures `QueueStorageOptions` (e.g. `raiseOnFailureStatus` / `catchExceptions`).
 */
export function useQueueStorage(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<QueueStorageContext>,
  configure?: (options: QueueStorageOptions) => void,
): IAzureFunctionAppBuilder {
  const pipeline = app.create<QueueStorageContext>();
  action(pipeline);
  // Registered AFTER `action` so an inner `useBenzeneMessage` pipeline's `BenzeneMessage` getters win
  // over these `tryAdd` transport getters under the shared erased token — see `addQueueStorage`.
  app.register((x) => addQueueStorage(x));
  const options = new QueueStorageOptions();
  configure?.(options);
  app.add(
    (serviceResolverFactory) =>
      new QueueStorageApplication(pipeline.build(), serviceResolverFactory, options),
  );
  return app;
}
