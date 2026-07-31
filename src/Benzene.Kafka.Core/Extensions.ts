import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { addBenzene } from '@benzene/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzene/self-host';
import { BenzeneKafkaConfig } from './BenzeneKafkaConfig';
import { BenzeneKafkaWorker } from './BenzeneKafkaWorker';
import { addKafkaConsumer } from './DependencyInjectionExtensions';
import { IKafkaAdminClientFactory } from './IKafkaAdminClientFactory';
import { IKafkaConsumerFactory } from './IKafkaConsumerFactory';
import { addKafkaDependencyHealthCheck } from './KafkaHealthCheckExtensions';
import { useBenzeneInvocation } from './KafkaMessage/BenzeneInvocationExtensions';
import { KafkaApplication } from './KafkaMessage/KafkaApplication';
import { KafkaRecordContext } from './KafkaMessage/KafkaRecordContext';

/**
 * Port of Benzene.Kafka.Core.Extensions.UseKafka (C# fluent extension method -> free function taking the
 * worker startup as its first argument).
 *
 * Adds a standalone Kafka consumer to a Benzene worker. Unlike `@benzene/aws-lambda-kafka` /
 * `@benzene/azure-function-kafka`, which process records delivered via a cloud trigger, this package
 * consumes topics directly using {@link BenzeneKafkaWorker} — intended for long-running workers (e.g.
 * `@benzene/self-host`).
 *
 * DEFERRED from the C# `UseKafka`: the `deadLetterOptions` parameter (retry-then-dead-letter re-produce)
 * leans on Confluent's manual offset seams kafkajs does not expose the same way.
 *
 * PORT DIVERGENCE — the auto-wired reachability `healthCheck`. C# builds the admin client from
 * `config.ConsumerConfig`; the TypeScript config carries no broker settings and `consumerFactory` yields a
 * `Consumer` (no route to an `Admin`), so the health check needs a separate {@link IKafkaAdminClientFactory}.
 * Pass one to enable the check (auto-registered on the deep `healthcheck` layer via
 * `@benzene/health-checks-core`); with no admin factory it is a no-op regardless of `healthCheck`. Set
 * `healthCheck = false` to opt out even when a factory is supplied.
 *
 * @param app The worker startup to add the Kafka consumer to.
 * @param config The topics and processing behaviour to use.
 * @param consumerFactory The factory used to create the underlying kafkajs `Consumer` (which decides the
 *   brokers, group id, and authentication).
 * @param action Configures the inner Kafka message pipeline.
 * @param adminClientFactory Optional admin-client + bootstrap-servers seam enabling the reachability
 *   health check (see the divergence above).
 * @param healthCheck When `true` (the default) and an `adminClientFactory` is supplied, auto-registers the
 *   metadata reachability check. Pass `false` to opt out.
 * @returns The worker startup, for chaining.
 */
export function useKafka(
  app: IBenzeneWorkerStartup,
  config: BenzeneKafkaConfig,
  consumerFactory: IKafkaConsumerFactory,
  action: PipelineBuilderAction<KafkaRecordContext>,
  adminClientFactory?: IKafkaAdminClientFactory,
  healthCheck = true,
): IBenzeneWorkerStartup {
  // PORT DIVERGENCE: C# calls `AddBenzeneMessage()` here; under the port's type erasure that would
  // register `BenzeneMessageGetter` under the single `IMessageGetter` / `IMessageBodyBytesGetter`
  // tokens and hijack routing/request-mapping over the Kafka getters (the record context is not the
  // Benzene envelope). So the port wires `addBenzene` (base services, no message-envelope getters) +
  // the consumer's own getters — as `useGrpc` / the standalone SQS/Service Bus/Event Hub consumers do
  // (see the gRPC "wiring" divergence note in the README, which documents this same type-erasure fix).
  app.register((x) => {
    addBenzene(x);
    addKafkaConsumer(x);
  });

  if (healthCheck && adminClientFactory !== undefined) {
    app.register((x) => addKafkaDependencyHealthCheck(x, adminClientFactory, config));
  }

  const middlewarePipelineBuilder = app.create<KafkaRecordContext>();
  useBenzeneInvocation(middlewarePipelineBuilder);
  action(middlewarePipelineBuilder);
  const pipeline = middlewarePipelineBuilder.build();

  const application = new KafkaApplication(pipeline);
  // Register the built application so it can be resolved and driven directly — e.g. a StartUp-based
  // component test pushing a record through the real pipeline without a running broker. Inert in a normal
  // worker run; the worker already holds this same instance via the factory below.
  app.register((x) => x.addSingletonInstance(KafkaApplication, application));
  app.add(
    (serviceResolverFactory) =>
      new BenzeneKafkaWorker(serviceResolverFactory, application, config, consumerFactory),
  );
  return app;
}
