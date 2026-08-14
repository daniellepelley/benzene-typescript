/**
 * Port of Benzene.Azure.ServiceBus.TestHelpers.BenzeneTestHostExtensions — the Service Bus worker
 * specialization step for `benzeneTestHost(...)`. This is the ONE transport-specific line in an
 * otherwise neutral test setup: everything before it (`benzeneTestHost`, `.withServices`,
 * `.withConfiguration`) is identical to every other transport; only this call and the
 * `asAzureServiceBusMessage` builder name change (the harness consistency law).
 *
 * IDIOM MAP: the C# `BuildServiceBusWorkerHost<TStartUp>(this BenzeneTestHostBuilder<TStartUp>)`
 * extension method becomes a TypeScript **fluent method** added to the builder by module augmentation +
 * a prototype assignment — the same shape the sibling AWS Lambda helper's `buildAwsLambdaHost()` uses,
 * keeping the `benzeneTestHost(StartUp).withServices(...).buildServiceBusWorkerHost()` chain intact. The
 * neutral `@benzenejs/testing` core stays free of any cloud import; importing this package (for its
 * `asAzureServiceBusMessage` builder) is what lights the method up. A `this` constraint pins it to a
 * startup whose `configure` receives the unified `IBenzeneApplicationBuilder`.
 */
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { ServiceBusConsumerApplication } from '@benzenejs/azure-service-bus';
import { WorkerApplicationBuilder } from '@benzenejs/self-host';
import { BenzeneTestHostBuilder } from '@benzenejs/testing';
import { ServiceBusWorkerBenzeneTestHost } from './ServiceBusWorkerBenzeneTestHost';

declare module '@benzenejs/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds a {@link ServiceBusWorkerBenzeneTestHost} from the startup + any `withServices`/
     * `withConfiguration` overrides — the same message pipeline `useServiceBus` builds for a real
     * worker, with a seam for test overrides but no broker connection. Push a native message into it
     * with `host.handleAsync(...)` (build one from a `messageBuilder(...)` via
     * `asAzureServiceBusMessage(...)`).
     *
     * The `this` constraint pins it to a builder whose startup's `configure` receives the unified
     * `IBenzeneApplicationBuilder` (select the worker inside it with
     * `useWorker(app, workers => useServiceBus(workers, …))`).
     */
    buildServiceBusWorkerHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): ServiceBusWorkerBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildServiceBusWorkerHost = function buildServiceBusWorkerHost(
  this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
): ServiceBusWorkerBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const appBuilder = new WorkerApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);

    const serviceResolverFactory = container.createServiceResolverFactory();
    const scope = serviceResolverFactory.createScope();
    let application: ServiceBusConsumerApplication;
    try {
      application = scope.getService(ServiceBusConsumerApplication);
    } finally {
      scope.dispose();
    }

    return new ServiceBusWorkerBenzeneTestHost(application, serviceResolverFactory);
  });
};
