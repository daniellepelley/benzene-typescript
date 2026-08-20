/** Port of Benzene.Azure.ServiceBus.ServiceBusHealthCheckExtensions. */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { addDependencyHealthCheck } from '@benzenejs/health-checks-core';
import { ServiceBusHealthCheck } from '@benzenejs/health-checks-azure-service-bus';
import { BenzeneServiceBusConfig } from './BenzeneServiceBusConfig';
import { IServiceBusClientFactory } from './IServiceBusClientFactory';

/**
 * Registration helper that auto-wires the consumer-side {@link ServiceBusHealthCheck} from the worker's
 * config + client factory. Auto-wiring lives on the **consumer** (not the sender): the peek-based check
 * needs the `Listen` claim the consumer holds, and it knows the exact entity (queue, or topic +
 * subscription) it consumes — the sender has neither.
 *
 * Auto-registers a {@link ServiceBusHealthCheck} for the consumed entity on the **dependency** category
 * (deep `benzene:healthcheck` layer only — never a Kubernetes probe; see `IDependencyHealthCheck`), deduped by
 * the entity. Called by `useServiceBus(..., healthCheck = true)`. One `ServiceBusClient` is created from
 * the factory and reused across probes (the check opens a short-lived receiver per probe).
 *
 * @param services The service container to register on.
 * @param config The consumer config identifying the queue, or topic + subscription.
 * @param clientFactory The factory used to create the (reused) Service Bus client.
 * @returns The service container, for chaining.
 */
export function addServiceBusDependencyHealthCheck(
  services: IBenzeneServiceContainer,
  config: BenzeneServiceBusConfig,
  clientFactory: IServiceBusClientFactory,
): IBenzeneServiceContainer {
  // ServiceBusClient construction is lazy (no connection until a receiver is used), so creating it here
  // and reusing it is cheap and avoids a per-probe client.
  const client = clientFactory.create();
  const isQueue = config.queueName !== undefined && config.queueName !== '';

  const check = isQueue
    ? new ServiceBusHealthCheck(client, config.queueName!)
    : new ServiceBusHealthCheck(client, config.topicName!, config.subscriptionName!);

  const dedupKey = isQueue
    ? `ServiceBus:${config.queueName}`
    : `ServiceBus:${config.topicName}/${config.subscriptionName}`;

  return addDependencyHealthCheck(services, () => check, dedupKey);
}
