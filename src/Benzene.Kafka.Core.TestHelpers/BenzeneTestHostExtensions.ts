/**
 * Port of Benzene.Kafka.Core.TestHelpers.BenzeneTestHostExtensions — the Kafka worker specialization
 * step for `benzeneTestHost(...)`. This is the ONE transport-specific line in an otherwise neutral test
 * setup: everything before it (`benzeneTestHost`, `.withServices`, `.withConfiguration`) is identical to
 * every other transport; only this call and the `asKafkaBenzeneMessage` builder name change (the harness
 * consistency law).
 *
 * IDIOM MAP: the C# `BuildKafkaWorkerHost<TStartUp, TKey, TValue>(this BenzeneTestHostBuilder<TStartUp>)`
 * extension method becomes a TypeScript **fluent method** added to the builder by module augmentation + a
 * prototype assignment — the same shape the sibling Service Bus / Event Hub helpers use, keeping the
 * `benzeneTestHost(StartUp).withServices(...).buildKafkaWorkerHost()` chain intact. The `TKey`/`TValue`
 * type parameters are dropped (the port's `KafkaApplication` erases them — see its docs). The neutral
 * `@benzenejs/testing` core stays free of any transport import; importing this package (for its
 * `asKafkaBenzeneMessage` builder) is what lights the method up. A `this` constraint pins it to a startup
 * whose `configure` receives the unified `IBenzeneApplicationBuilder`.
 */
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { KafkaApplication } from '@benzenejs/kafka-core';
import { WorkerApplicationBuilder } from '@benzenejs/self-host';
import { BenzeneTestHostBuilder } from '@benzenejs/testing';
import { KafkaBenzeneTestHost } from './KafkaBenzeneTestHost';

declare module '@benzenejs/testing' {
  interface BenzeneTestHostBuilder<TAppBuilder> {
    /**
     * Builds a {@link KafkaBenzeneTestHost} from the startup + any `withServices`/`withConfiguration`
     * overrides — the same message pipeline `useKafka` builds for a real worker, with a seam for test
     * overrides but no broker connection. Push a native record into it with `host.handleAsync(...)`
     * (build one from a `messageBuilder(...)` via `asKafkaBenzeneMessage(...)`).
     *
     * The `this` constraint pins it to a builder whose startup's `configure` receives the unified
     * `IBenzeneApplicationBuilder` (select the worker inside it with
     * `useWorker(app, workers => useKafka(workers, …))`).
     */
    buildKafkaWorkerHost(
      this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
    ): KafkaBenzeneTestHost;
  }
}

BenzeneTestHostBuilder.prototype.buildKafkaWorkerHost = function buildKafkaWorkerHost(
  this: BenzeneTestHostBuilder<IBenzeneApplicationBuilder>,
): KafkaBenzeneTestHost {
  return this.build(({ startUp, container, configuration }) => {
    const appBuilder = new WorkerApplicationBuilder(container);
    startUp.configure(appBuilder, configuration);

    const serviceResolverFactory = container.createServiceResolverFactory();
    const scope = serviceResolverFactory.createScope();
    let application: KafkaApplication;
    try {
      application = scope.getService(KafkaApplication);
    } finally {
      scope.dispose();
    }

    return new KafkaBenzeneTestHost(application, serviceResolverFactory);
  });
};
