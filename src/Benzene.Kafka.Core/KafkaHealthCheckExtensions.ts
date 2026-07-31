/** Port of Benzene.Kafka.Core.KafkaHealthCheckExtensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { addDependencyHealthCheck, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { BenzeneKafkaConfig } from './BenzeneKafkaConfig';
import { IKafkaAdminClientFactory } from './IKafkaAdminClientFactory';
import { KafkaHealthCheck } from './KafkaHealthCheck';

/**
 * Registers a {@link KafkaHealthCheck} for `config`'s subscribed topics on an explicit health-check
 * builder, using `adminClientFactory` for the metadata probe (and the bootstrap-servers identity).
 *
 * PORT DIVERGENCE: C#'s `AddKafkaHealthCheck` builds the admin factory from `config.ConsumerConfig`; the
 * TypeScript config carries no broker settings, so the {@link IKafkaAdminClientFactory} is supplied
 * explicitly (see its docs).
 *
 * @param builder The health check builder to register against.
 * @param adminClientFactory The admin-client + bootstrap-servers seam used by the probe.
 * @param config The Kafka consumer config whose subscribed `topics` to verify.
 * @returns The health check builder, for chaining.
 */
export function addKafkaHealthCheck(
  builder: IHealthCheckBuilder,
  adminClientFactory: IKafkaAdminClientFactory,
  config: BenzeneKafkaConfig,
): IHealthCheckBuilder {
  return builder.addHealthCheckFn(() => new KafkaHealthCheck(adminClientFactory, config.topics));
}

/**
 * Auto-registers a {@link KafkaHealthCheck} for `config`'s topics on the **dependency** category (deep
 * `healthcheck` layer only — never a Kubernetes probe; see `IDependencyHealthCheck`), deduped by the
 * bootstrap servers. Called by `useKafka(..., adminClientFactory, healthCheck = true)`.
 *
 * @param services The service container to register on.
 * @param adminClientFactory The admin-client + bootstrap-servers seam used by the probe.
 * @param config The Kafka consumer config and subscribed topics.
 * @returns The service container, for chaining.
 */
export function addKafkaDependencyHealthCheck(
  services: IBenzeneServiceContainer,
  adminClientFactory: IKafkaAdminClientFactory,
  config: BenzeneKafkaConfig,
): IBenzeneServiceContainer {
  return addDependencyHealthCheck(
    services,
    () => new KafkaHealthCheck(adminClientFactory, config.topics),
    `Kafka:${adminClientFactory.bootstrapServers}`,
  );
}
