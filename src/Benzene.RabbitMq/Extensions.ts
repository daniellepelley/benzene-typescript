import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
import { addRabbitMqConsumer } from './DependencyInjectionExtensions';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';
import { RabbitMqApplication } from './RabbitMqMessage/RabbitMqApplication';
import { RabbitMqConfig } from './RabbitMqConfig';
import { RabbitMqConstants } from './RabbitMqConstants';
import { RabbitMqContext } from './RabbitMqMessage/RabbitMqContext';
import { addRabbitMqDependencyHealthCheck } from './RabbitMqHealthCheckExtensions';
import { RabbitMqWorker } from './RabbitMqWorker';

/**
 * Port of Benzene.RabbitMq.Extensions.UseRabbitMq (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a self-hosted RabbitMQ consumer to a Benzene worker, mirroring `useKafka`/`useServiceBus`. This is
 * the first vendor-neutral, self-hosted broker in Benzene — intended for long-running workers (console,
 * container, Kubernetes) via `@benzenejs/self-host`.
 *
 * DIVERGENCE — no SeedCancellationToken middleware. The C# `UseRabbitMq` seeds each scope's ambient
 * cancellation token from the delivery. The port has no ambient cancellation-token DI seam yet (matching
 * `useServiceBus`), so that middleware is not added.
 *
 * OUTBOUND PUBLISH — ported in the `RabbitMqSendMessage/` subdirectory (`RabbitMqBenzeneMessageClient`,
 * `RabbitMqClientMiddleware`, `RabbitMqContextConverter`, `useRabbitMqClient`); this file is the
 * consumer-worker entry point (`useRabbitMq`). See the README `@benzenejs/rabbitmq` bullet.
 *
 * @param app The worker startup to add the RabbitMQ consumer to.
 * @param config The queue to consume and the processing behaviour to use.
 * @param connectionFactory The factory used to open the RabbitMQ connection (the caller decides host,
 *   credentials, vhost, TLS).
 * @param action Configures the inner RabbitMQ message pipeline.
 * @param healthCheck When `true` (the default) a non-destructive passive-declare reachability check for
 *   the consumed queue is auto-registered on the deep `healthcheck` layer (a dedicated reused connection,
 *   a cheap channel per probe) — never a Kubernetes probe (a broker being unreachable is shared-fate; see
 *   `IDependencyHealthCheck`). Pass `false` to opt out.
 * @returns The worker startup, for chaining.
 */
export function useRabbitMq(
  app: IBenzeneWorkerStartup,
  config: RabbitMqConfig,
  connectionFactory: IRabbitMqConnectionFactory,
  action: PipelineBuilderAction<RabbitMqContext>,
  healthCheck = true,
): IBenzeneWorkerStartup {
  const topicHeaderKey = config.topicHeaderKey ?? RabbitMqConstants.DefaultTopicHeader;

  // PORT DIVERGENCE: C# calls `AddBenzeneMessage()` here; under the port's type erasure that would
  // register `BenzeneMessageGetter` under the single `IMessageGetter` / `IMessageBodyBytesGetter`
  // tokens and hijack routing/request-mapping over the RabbitMq getters (the delivery context is not
  // the Benzene envelope). So the port wires `addBenzene` (base services, no message-envelope getters)
  // + the consumer's own getters — as `useGrpc` / the standalone SQS/Service Bus/Event Hub consumers do
  // (see the gRPC "wiring" divergence note in the README, which documents this same type-erasure fix).
  app.register((x) => {
    addBenzene(x);
    addRabbitMqConsumer(x, topicHeaderKey);
  });

  if (healthCheck) {
    app.register((x) => addRabbitMqDependencyHealthCheck(x, config, connectionFactory));
  }

  const middlewarePipelineBuilder = app.create<RabbitMqContext>();
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new RabbitMqApplication(pipeline);
  // Register the built application so it can be resolved and driven directly — e.g. a StartUp-based
  // component test pushing a delivery through the real pipeline without a running broker. Inert in a
  // normal worker run; the worker already holds this same instance via the factory below.
  app.register((x) => x.addSingletonInstance(RabbitMqApplication, application));
  app.add(
    (serviceResolverFactory) =>
      new RabbitMqWorker(serviceResolverFactory, application, config, connectionFactory),
  );
  return app;
}
