/** Port of Benzene.Azure.Function.BlobStorage.DependencyInjectionExtensions (C# extension methods -> free functions). */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { ITransportInfo, TransportNames } from '@benzenejs/abstractions-message-handlers';
import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { TransportInfo } from '@benzenejs/core-message-handlers';
import { IAzureFunctionAppBuilder } from '@benzenejs/azure-function-core';
import { BlobStorageApplication } from './BlobStorageApplication';
import { BlobStorageContext } from './BlobStorageContext';

/**
 * Registers the services blob-trigger handling depends on beyond the entry point application itself —
 * currently just the `ITransportInfo` advertising `"blob-storage"` as a wired transport. Called
 * automatically by `useBlobStorage`; you don't normally call it directly.
 *
 * C# name: `AddAzureBlobStorage`. Renamed `addBlobStorage` here to match the package's public surface.
 * There are no per-message getters/result-setter (unlike the routed transports) — a blob is a file, not
 * a message envelope, so nothing routes.
 *
 * @param services The service container to register services with.
 */
export function addBlobStorage(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.BlobStorage));
  return services;
}

/**
 * Adds a blob entry point application to the Azure Function app builder, configuring its inner
 * middleware pipeline. Port of C# `DependencyInjectionExtensions.UseBlobStorage(this
 * IAzureFunctionAppBuilder, ...)`. There is no `useMessageHandlers()`-style routing on this transport —
 * a blob is a file, not a message envelope, and one blob-trigger function watches one container path —
 * so the pipeline is consumed with `useBlob(...)` (or any ordinary middleware), composing with
 * correlation/metrics/exception middleware as usual.
 *
 * DEFERRED: the C# `UseBlobStorage(this IBenzeneApplicationBuilder, ...)` host-neutral overload is not
 * ported — it depends on the unported `IBenzeneApplicationBuilder` generic-host abstraction (the same
 * deferral as the ported `useServiceBus`/`useTimerTrigger`).
 *
 * @param app The Azure Function app builder to add blob handling to.
 * @param action Configures the blob middleware pipeline.
 */
export function useBlobStorage(
  app: IAzureFunctionAppBuilder,
  action: PipelineBuilderAction<BlobStorageContext>,
): IAzureFunctionAppBuilder {
  app.register((x) => addBlobStorage(x));
  const pipeline = app.create<BlobStorageContext>();
  action(pipeline);
  app.add(
    (serviceResolverFactory) => new BlobStorageApplication(pipeline.build(), serviceResolverFactory),
  );
  return app;
}
