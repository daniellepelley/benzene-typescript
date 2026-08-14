import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
import { BenzeneServiceBusConfig } from './BenzeneServiceBusConfig';
import { BenzeneServiceBusWorker } from './BenzeneServiceBusWorker';
import { IServiceBusClientFactory } from './IServiceBusClientFactory';
import { ServiceBusConsumerApplication } from './ServiceBusConsumerApplication';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';
import { ServiceBusConsumerMessageTopicGetter } from './ServiceBusConsumerMessageTopicGetter';
import { addServiceBusConsumer } from './DependencyInjectionExtensions';
import { addServiceBusDependencyHealthCheck } from './ServiceBusHealthCheckExtensions';

/**
 * Port of Benzene.Azure.ServiceBus.Extensions (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a standalone Service Bus consumer to a Benzene worker. Unlike
 * `@benzenejs/azure-function-service-bus`, which processes messages delivered via an Azure Functions
 * Service Bus trigger, this package consumes an entity directly using {@link BenzeneServiceBusWorker} —
 * intended for long-running workers (e.g. `@benzenejs/self-host`) rather than Azure Functions.
 *
 * @param app The worker startup to add the Service Bus consumer to.
 * @param config The entity to consume and the processing behaviour to use.
 * @param serviceBusClientFactory The factory used to create the underlying `ServiceBusClient`.
 * @param action Configures the inner Service Bus message pipeline.
 * @param healthCheck When `true` (the default) a non-destructive Service Bus reachability check (a peek
 * of the consumed entity, using the `Listen` claim the consumer holds) is auto-registered on the deep
 * `healthcheck` layer via `@benzenejs/health-checks-azure-service-bus` — never a Kubernetes probe (a
 * broker being unreachable is shared-fate; see `IDependencyHealthCheck`). Pass `false` to opt out.
 * @returns The worker startup, for chaining.
 */
export function useServiceBus(
  app: IBenzeneWorkerStartup,
  config: BenzeneServiceBusConfig,
  serviceBusClientFactory: IServiceBusClientFactory,
  action: PipelineBuilderAction<ServiceBusConsumerContext>,
  healthCheck = true,
): IBenzeneWorkerStartup {
  const topicPropertyKey =
    config.topicPropertyKey ?? ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty;

  // PORT DIVERGENCE: C# `UseServiceBus` calls `AddBenzeneMessage()` here. Under the port's type
  // erasure that registers `BenzeneMessageGetter` under the single `IMessageGetter` /
  // `IMessageBodyBytesGetter` tokens (C#'s distinct `<TContext>` closed generics collapse to one),
  // which would hijack routing/request-mapping over the Service Bus getters and read the wrong context
  // shape. So the port wires `addBenzene` (base services, no message-envelope getters) + the consumer's
  // own getters instead — exactly as `useGrpc` and the standalone SQS consumer do (see the gRPC "wiring" divergence note in the README, which documents this same type-erasure fix).
  app.register((x) => {
    addBenzene(x);
    addServiceBusConsumer(x, topicPropertyKey);
  });

  if (healthCheck) {
    app.register((x) => addServiceBusDependencyHealthCheck(x, config, serviceBusClientFactory));
  }

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
