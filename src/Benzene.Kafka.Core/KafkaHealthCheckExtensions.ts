/** Port of Benzene.Kafka.Core.KafkaHealthCheckExtensions. */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { addDependencyHealthCheck, IHealthCheckBuilder } from '@benzenejs/health-checks-core';
import { BenzeneKafkaConfig } from './BenzeneKafkaConfig';
import { IKafkaAdminClientFactory } from './IKafkaAdminClientFactory';
import { KafkaHealthCheck } from './KafkaHealthCheck';

/**
 * Registers a {@link KafkaHealthCheck} for `config`'s subscribed topics on an explicit health-check
 * builder, using `adminClientFactory` for the metadata probe (and the bootstrap-servers identity).
 *
 * PORT DIVERGENCE: C#'s `AddKafkaHealthCheck` builds the admin factory from `config.ConsumerConfig`; the
 * TypeScript config carries no broker settings, so the {@link IKafkaAdminClientFactory} is supplied
 * explicitly (see its docs). The parameter comes *after* `config`, so this lines up with the
 * config-then-factory order of the sibling `addRabbitMqHealthCheck` / `addServiceBusDependencyHealthCheck`
 * helpers (there is no C# ordering to preserve here — `adminClientFactory` is a port-only parameter).
 *
 * @param builder The health check builder to register against.
 * @param config The Kafka consumer config whose subscribed `topics` to verify.
 * @param adminClientFactory The admin-client + bootstrap-servers seam used by the probe.
 * @returns The health check builder, for chaining.
 */
export function addKafkaHealthCheck(
  builder: IHealthCheckBuilder,
  config: BenzeneKafkaConfig,
  adminClientFactory: IKafkaAdminClientFactory,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(() => new KafkaHealthCheck(adminClientFactory, config.topics));
}

/**
 * Auto-registers a {@link KafkaHealthCheck} for `config`'s topics on the **dependency** category (deep
 * `benzene:healthcheck` layer only — never a Kubernetes probe; see `IDependencyHealthCheck`), deduped by the
 * bootstrap servers. Called by `useKafka(..., adminClientFactory, healthCheck = true)`.
 *
 * The `config`-then-`adminClientFactory` order matches the sibling `addRabbitMqDependencyHealthCheck` /
 * `addServiceBusDependencyHealthCheck` helpers.
 *
 * @param services The service container to register on.
 * @param config The Kafka consumer config and subscribed topics.
 * @param adminClientFactory The admin-client + bootstrap-servers seam used by the probe.
 * @returns The service container, for chaining.
 */
export function addKafkaDependencyHealthCheck(
  services: IBenzeneServiceContainer,
  config: BenzeneKafkaConfig,
  adminClientFactory: IKafkaAdminClientFactory,
): IBenzeneServiceContainer {
  return addDependencyHealthCheck(
    services,
    () => new KafkaHealthCheck(adminClientFactory, config.topics),
    `Kafka:${adminClientFactory.bootstrapServers}`,
  );
}
