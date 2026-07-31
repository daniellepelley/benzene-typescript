/**
 * Port of Benzene.RabbitMq.TestHelpers.BenzeneTestHostExtensions — the RabbitMQ worker specialization
 * step for `benzeneTestHost(...)`. This is the ONE transport-specific line in an otherwise neutral test
 * setup: everything before it (`benzeneTestHost`, `.withServices`, `.withConfiguration`) is identical to
 * every other transport; only this call and the `asRabbitMqBenzeneMessage` builder name change (the
 * harness consistency law).
 *
 * IDIOM MAP: the C# `BuildRabbitMqWorkerHost<TStartUp>(this BenzeneTestHostBuilder<TStartUp>)` extension
 * method becomes a TypeScript **fluent method** added to the builder by module augmentation + a
 * prototype assignment — the same shape the sibling Service Bus / Event Hub helpers use, keeping the
 * `benzeneTestHost(StartUp).withServices(...).buildRabbitMqWorkerHost()` chain intact. The neutral
 * `@benzene/testing` core stays free of any transport import; importing this package (for its
 * `asRabbitMqBenzeneMessage` builder) is what lights the method up. A `this` constraint pins it to a
 * startup whose `configure` receives the unified `IBenzeneApplicationBuilder`.
 */
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { RabbitMqApplication } from '@benzene/rabbitmq';
import { WorkerApplicationBuilder } from '@benzene/self-host';
import { BenzeneTestHostBuilder } from '@benzene/testing';
import { RabbitMqBenzeneTestHost } from './RabbitMqBenzeneTestHost';

declare module '@benzene/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds a {@link RabbitMqBenzeneTestHost} from the startup + any `withServices`/`withConfiguration`
     * overrides — the same message pipeline `useRabbitMq` builds for a real worker, with a seam for test
     * overrides but no broker connection. Push a native delivery into it with `host.handleAsync(...)`
     * (build one from a `messageBuilder(...)` via `asRabbitMqBenzeneMessage(...)`).
     *
     * The `this` constraint pins it to a builder whose startup's `configure` receives the unified
     * `IBenzeneApplicationBuilder` (select the worker inside it with
     * `useWorker(app, workers => useRabbitMq(workers, …))`).
     */
    buildRabbitMqWorkerHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): RabbitMqBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildRabbitMqWorkerHost = function buildRabbitMqWorkerHost(
  this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
): RabbitMqBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const appBuilder = new WorkerApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);

    const serviceResolverFactory = container.createServiceResolverFactory();
    const scope = serviceResolverFactory.createScope();
    let application: RabbitMqApplication;
    try {
      application = scope.getService(RabbitMqApplication);
    } finally {
      scope.dispose();
    }

    return new RabbitMqBenzeneTestHost(application, serviceResolverFactory);
  });
};
