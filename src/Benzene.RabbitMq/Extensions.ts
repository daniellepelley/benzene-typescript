import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { addBenzeneMessage } from '@benzene/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzene/self-host';
import { addRabbitMqConsumer } from './DependencyInjectionExtensions';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';
import { RabbitMqApplication } from './RabbitMqMessage/RabbitMqApplication';
import { RabbitMqConfig } from './RabbitMqConfig';
import { RabbitMqConstants } from './RabbitMqConstants';
import { RabbitMqContext } from './RabbitMqMessage/RabbitMqContext';
import { RabbitMqWorker } from './RabbitMqWorker';

/**
 * Port of Benzene.RabbitMq.Extensions.UseRabbitMq (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a self-hosted RabbitMQ consumer to a Benzene worker, mirroring `useKafka`/`useServiceBus`. This is
 * the first vendor-neutral, self-hosted broker in Benzene — intended for long-running workers (console,
 * container, Kubernetes) via `@benzene/self-host`.
 *
 * DIVERGENCE — no auto-wired health check. The C# overload takes a `healthCheck` flag (default on) that
 * auto-registers a passive-declare RabbitMQ dependency health check. The TypeScript port omits it: the
 * health-check package (`RabbitMqHealthCheck` / `RabbitMqConnectionProvider` / the flag) is out of scope
 * for this port (the health-check domain is owned separately), so wire a check manually once the package
 * exists. See the README porting-conventions bullet.
 *
 * DIVERGENCE — no SeedCancellationToken middleware. The C# `UseRabbitMq` seeds each scope's ambient
 * cancellation token from the delivery. The port has no ambient cancellation-token DI seam yet (matching
 * `useServiceBus`), so that middleware is not added.
 *
 * DEFERRED — outbound publish. The C# package also ships an outbound publish slice (`RabbitMqSendMessage/`:
 * `RabbitMqBenzeneMessageClient`, `RabbitMqClientMiddleware`, `.UseRabbitMq<T>(...)`). This port covers
 * the consumer-worker core only; the publish client is a tracked follow-up (see the README bullet).
 *
 * @param app The worker startup to add the RabbitMQ consumer to.
 * @param config The queue to consume and the processing behaviour to use.
 * @param connectionFactory The factory used to open the RabbitMQ connection (the caller decides host,
 *   credentials, vhost, TLS).
 * @param action Configures the inner RabbitMQ message pipeline.
 * @returns The worker startup, for chaining.
 */
export function useRabbitMq(
  app: IBenzeneWorkerStartup,
  config: RabbitMqConfig,
  connectionFactory: IRabbitMqConnectionFactory,
  action: PipelineBuilderAction<RabbitMqContext>,
): IBenzeneWorkerStartup {
  const topicHeaderKey = config.topicHeaderKey ?? RabbitMqConstants.DefaultTopicHeader;

  app.register((x) => {
    addBenzeneMessage(x);
    addRabbitMqConsumer(x, topicHeaderKey);
  });

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
