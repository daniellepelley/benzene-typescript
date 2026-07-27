import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzene/self-host';
import { BenzeneServiceBusConfig } from './BenzeneServiceBusConfig';
import { BenzeneServiceBusWorker } from './BenzeneServiceBusWorker';
import { IServiceBusClientFactory } from './IServiceBusClientFactory';
import { ServiceBusConsumerApplication } from './ServiceBusConsumerApplication';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';
import { ServiceBusConsumerMessageTopicGetter } from './ServiceBusConsumerMessageTopicGetter';
import { addServiceBusConsumer } from './DependencyInjectionExtensions';

/**
 * Port of Benzene.Azure.ServiceBus.Extensions (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a standalone Service Bus consumer to a Benzene worker. Unlike
 * `@benzene/azure-function-service-bus`, which processes messages delivered via an Azure Functions
 * Service Bus trigger, this package consumes an entity directly using {@link BenzeneServiceBusWorker} —
 * intended for long-running workers (e.g. `@benzene/self-host`) rather than Azure Functions.
 *
 * DIVERGENCE: the C# overload takes a `healthCheck` flag (default on) that auto-registers a peek-based
 * Service Bus dependency health check. The TypeScript port has no Azure Service Bus health-check package
 * yet, so that parameter and its registration are omitted (tracked in the README roadmap); wire a health
 * check manually once the package exists.
 *
 * @param app The worker startup to add the Service Bus consumer to.
 * @param config The entity to consume and the processing behaviour to use.
 * @param serviceBusClientFactory The factory used to create the underlying `ServiceBusClient`.
 * @param action Configures the inner Service Bus message pipeline.
 * @returns The worker startup, for chaining.
 */
export function useServiceBus(
  app: IBenzeneWorkerStartup,
  config: BenzeneServiceBusConfig,
  serviceBusClientFactory: IServiceBusClientFactory,
  action: PipelineBuilderAction<ServiceBusConsumerContext>,
): IBenzeneWorkerStartup {
  const topicPropertyKey =
    config.topicPropertyKey ?? ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty;

  app.register((x) => {
    addBenzeneMessage(x);
    addServiceBusConsumer(x, topicPropertyKey);
  });

  const middlewarePipelineBuilder = app.create<ServiceBusConsumerContext>();
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new ServiceBusConsumerApplication(pipeline);
  // Register the built application so it can be resolved and driven directly — e.g. a StartUp-based
  // component test pushing a message through the real pipeline without a running broker. Inert in a
  // normal worker run; the worker already holds this same instance via the factory below.
  app.register((x) => x.addSingletonInstance(ServiceBusConsumerApplication, application));
  app.add(
    (serviceResolverFactory) =>
      new BenzeneServiceBusWorker(serviceResolverFactory, application, config, serviceBusClientFactory),
  );
  return app;
}
