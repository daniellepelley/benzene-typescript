import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
import { useBenzeneInvocation } from './BenzeneInvocationExtensions';
import { BenzeneEventHubConfig } from './BenzeneEventHubConfig';
import { BenzeneEventHubWorker } from './BenzeneEventHubWorker';
import { EventHubConsumerApplication } from './EventHubConsumerApplication';
import { EventHubConsumerContext } from './EventHubConsumerContext';
import { EventHubConsumerMessageTopicGetter } from './EventHubConsumerMessageTopicGetter';
import { IEventProcessorClientFactory } from './IEventProcessorClientFactory';
import { addEventHubConsumer } from './DependencyInjectionExtensions';

/**
 * Port of Benzene.Azure.EventHub.Extensions (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a standalone Event Hub consumer to a Benzene worker. Unlike `@benzenejs/azure-function-event-hub`,
 * which processes events delivered via an Azure Functions Event Hub trigger, this package consumes a hub
 * directly using {@link BenzeneEventHubWorker} — intended for long-running workers (e.g.
 * `@benzenejs/self-host`) rather than Azure Functions.
 *
 * @param app The worker startup to add the Event Hub consumer to.
 * @param config The checkpointing and failure-handling behaviour to use.
 * @param eventProcessorClientFactory The factory used to create the underlying consumer client (which
 *   decides the hub, consumer group, checkpoint store, and authentication).
 * @param action Configures the inner Event Hub message pipeline.
 * @returns The worker startup, for chaining.
 */
export function useEventHub(
  app: IBenzeneWorkerStartup,
  config: BenzeneEventHubConfig,
  eventProcessorClientFactory: IEventProcessorClientFactory,
  action: PipelineBuilderAction<EventHubConsumerContext>,
): IBenzeneWorkerStartup {
  const topicPropertyKey =
    config.topicPropertyKey ?? EventHubConsumerMessageTopicGetter.DefaultTopicProperty;

  // PORT DIVERGENCE: C# calls `AddBenzeneMessage()` here; under the port's type erasure that would
  // register `BenzeneMessageGetter` under the single `IMessageGetter` / `IMessageBodyBytesGetter`
  // tokens and hijack routing/request-mapping over the Event Hub getters. So the port wires `addBenzene`
  // (base services, no message-envelope getters) + the consumer's own getters — as `useGrpc` does
  // (see the gRPC "wiring" divergence note in the README, which documents this same type-erasure fix).
  app.register((x) => {
    addBenzene(x);
    addEventHubConsumer(x, topicPropertyKey);
  });

  const middlewarePipelineBuilder = app.create<EventHubConsumerContext>();
  useBenzeneInvocation(middlewarePipelineBuilder);
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new EventHubConsumerApplication(pipeline);
  // Register the built application so it can be resolved and driven directly — e.g. a StartUp-based
  // component test pushing an event through the real pipeline without a running hub. Inert in a normal
  // worker run; the worker already holds this same instance via the factory below.
  app.register((x) => x.addSingletonInstance(EventHubConsumerApplication, application));
  app.add(
    (serviceResolverFactory) =>
      new BenzeneEventHubWorker(serviceResolverFactory, application, config, eventProcessorClientFactory),
  );
  return app;
}
