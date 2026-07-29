/**
 * Port of Benzene.Azure.EventHub.TestHelpers.BenzeneTestHostExtensions — the Event Hub worker
 * specialization step for `benzeneTestHost(...)`. This is the ONE transport-specific line in an
 * otherwise neutral test setup: everything before it (`benzeneTestHost`, `.withServices`,
 * `.withConfiguration`) is identical to every other transport; only this call and the
 * `asEventHubBenzeneMessage` builder name change (the harness consistency law).
 *
 * IDIOM MAP: the C# `BuildEventHubWorkerHost<TStartUp>(this BenzeneTestHostBuilder<TStartUp>)` extension
 * method becomes a TypeScript **fluent method** added to the builder by module augmentation + a prototype
 * assignment — the same shape the sibling AWS Lambda helper's `buildAwsLambdaHost()` uses, keeping the
 * `benzeneTestHost(StartUp).withServices(...).buildEventHubWorkerHost()` chain intact. The neutral
 * `@benzene/testing` core stays free of any cloud import; importing this package (for its
 * `asEventHubBenzeneMessage` builder) is what lights the method up. A `this` constraint pins it to a
 * startup whose `configure` receives the unified `IBenzeneApplicationBuilder`.
 */
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { EventHubConsumerApplication } from '@benzene/azure-event-hub';
import { WorkerApplicationBuilder } from '@benzene/self-host';
import { BenzeneTestHostBuilder } from '@benzene/testing';
import { EventHubWorkerBenzeneTestHost } from './EventHubWorkerBenzeneTestHost';

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds an {@link EventHubWorkerBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same message pipeline `useEventHub` builds for a real worker,
     * with a seam for test overrides but no hub connection. Push a native event into it with
     * `host.handleAsync(...)` (build one from a `messageBuilder(...)` via
     * `asEventHubBenzeneMessage(...)`).
     *
     * The `this` constraint pins it to a builder whose startup's `configure` receives the unified
     * `IBenzeneApplicationBuilder` (select the worker inside it with
     * `useWorker(app, workers => useEventHub(workers, …))`).
     */
    buildEventHubWorkerHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): EventHubWorkerBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildEventHubWorkerHost = function buildEventHubWorkerHost(
  this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
): EventHubWorkerBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const appBuilder = new WorkerApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);

    const serviceResolverFactory = container.createServiceResolverFactory();
    const scope = serviceResolverFactory.createScope();
    let application: EventHubConsumerApplication;
    try {
      application = scope.getService(EventHubConsumerApplication);
    } finally {
      scope.dispose();
    }

    return new EventHubWorkerBenzeneTestHost(application, serviceResolverFactory);
  });
};
