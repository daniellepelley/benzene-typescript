import { PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { addBenzene } from '@benzenejs/core-message-handlers';
import { IBenzeneWorkerStartup } from '@benzenejs/self-host';
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
 * Adds a standalone Kafka consumer to a Benzene worker. Unlike `@benzenejs/aws-lambda-kafka` /
 * `@benzenejs/azure-function-kafka`, which process records delivered via a cloud trigger, this package
 * consumes topics directly using {@link BenzeneKafkaWorker} — intended for long-running workers (e.g.
 * `@benzenejs/self-host`).
 *
 * DEFERRED from the C# `UseKafka`: the `deadLetterOptions` parameter (retry-then-dead-letter re-produce)
 * leans on Confluent's manual offset seams kafkajs does not expose the same way.
 *
 * PORT DIVERGENCE — the auto-wired reachability `healthCheck`. C# builds the admin client from
 * `config.ConsumerConfig`; the TypeScript config carries no broker settings and `consumerFactory` yields a
 * `Consumer` (no route to an `Admin`), so the health check needs a separate {@link IKafkaAdminClientFactory}.
 * Pass one to enable the check (auto-registered on the deep `healthcheck` layer via
 * `@benzenejs/health-checks-core`); with no admin factory it is a no-op regardless of `healthCheck`. Set
 * `healthCheck = false` to opt out even when a factory is supplied.
 *
 * @param app The worker startup to add the Kafka consumer to.
 * @param config The topics and processing behaviour to use.
 * @param consumerFactory The factory used to create the underlying kafkajs `Consumer` (which decides the
 *   brokers, group id, and authentication).
 * @param action Configures the inner Kafka message pipeline.
 * @param adminClientFactory Optional admin-client + bootstrap-servers seam enabling the reachability
 *   health check (see the divergence above).
 * @param healthCheck **A no-op unless `adminClientFactory` is also supplied.** When `true` (the default)
 *   AND an `adminClientFactory` is given, auto-registers the metadata reachability check; with no admin
 *   factory the default-`true` flag registers nothing (unlike `useServiceBus` / `useRabbitMq`, whose
 *   required worker factory already suffices — see the divergence above). Pass `false` to opt out even
 *   when a factory is supplied.
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
    app.register((x) => addKafkaDependencyHealthCheck(x, config, adminClientFactory));
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
