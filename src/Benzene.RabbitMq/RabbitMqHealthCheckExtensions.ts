/** Port of Benzene.RabbitMq.RabbitMqHealthCheckExtensions. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { addDependencyHealthCheck, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { IRabbitMqConnectionFactory } from './IRabbitMqConnectionFactory';
import { RabbitMqConfig } from './RabbitMqConfig';
import { RabbitMqConnectionProvider } from './RabbitMqConnectionProvider';
import { RabbitMqHealthCheck } from './RabbitMqHealthCheck';

/**
 * Registers a {@link RabbitMqHealthCheck} for `config`'s queue on an explicit health-check builder.
 * Captures a single reused {@link RabbitMqConnectionProvider}.
 *
 * @param builder The health check builder to register against.
 * @param config The RabbitMQ consumer config (its `queueName` is verified).
 * @param connectionFactory The factory used to open the (reused) health-check connection.
 * @returns The health check builder, for chaining.
 */
export function addRabbitMqHealthCheck(
  builder: IHealthCheckBuilder,
  config: RabbitMqConfig,
  connectionFactory: IRabbitMqConnectionFactory,
): IHealthCheckBuilder {
  const provider = new RabbitMqConnectionProvider(connectionFactory);
  return builder.addHealthCheckFn(() => new RabbitMqHealthCheck(provider, config.queueName));
}

/**
 * Auto-registers a {@link RabbitMqHealthCheck} for `config`'s queue on the **dependency** category (deep
 * `healthcheck` layer only — never a Kubernetes probe; see `IDependencyHealthCheck`), deduped by the queue
 * name. Called by `useRabbitMq(..., healthCheck = true)`. A single {@link RabbitMqConnectionProvider} is
 * captured and reused across probes (one connection, a cheap channel per probe).
 *
 * @param services The service container to register on.
 * @param config The RabbitMQ consumer config.
 * @param connectionFactory The factory used to open the (reused) health-check connection.
 * @returns The service container, for chaining.
 */
export function addRabbitMqDependencyHealthCheck(
  services: IBenzeneServiceContainer,
  config: RabbitMqConfig,
  connectionFactory: IRabbitMqConnectionFactory,
): IBenzeneServiceContainer {
  const provider = new RabbitMqConnectionProvider(connectionFactory);
  return addDependencyHealthCheck(
    services,
    () => new RabbitMqHealthCheck(provider, config.queueName),
    `RabbitMq:${config.queueName}`,
  );
}
