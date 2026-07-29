/** Port of Benzene.HealthChecks.Azure.ServiceBus.Extensions. */
import { ServiceBusClient } from '@azure/service-bus';
import { addHealthCheckFactory, IHealthCheckBuilder } from '@benzene/health-checks-core';
import { ServiceBusHealthCheckFactory } from './ServiceBusHealthCheckFactory';

/**
 * Registers a {@link ServiceBusHealthCheck} for a queue, peeking via the given `ServiceBusClient`.
 *
 * PORT DIVERGENCE: the C# `AddServiceBusQueueHealthCheck(queueName)` resolves `ServiceBusClient` from
 * DI; the TypeScript port takes the `@azure/service-bus` `ServiceBusClient` explicitly (there is no
 * synthetic DI token for the raw SDK client), matching the `@benzene/clients-azure-*` siblings.
 */
export function addServiceBusQueueHealthCheck(
  builder: IHealthCheckBuilder,
  client: ServiceBusClient,
  queueName: string,
): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new ServiceBusHealthCheckFactory(client, queueName));
}

/**
 * Registers a {@link ServiceBusHealthCheck} for a topic subscription, peeking via the given
 * `ServiceBusClient`.
 *
 * PORT DIVERGENCE: the C# `AddServiceBusSubscriptionHealthCheck(topicName, subscriptionName)` resolves
 * `ServiceBusClient` from DI; the TypeScript port takes it explicitly (there is no synthetic DI token
 * for the raw SDK client), matching the `@benzene/clients-azure-*` siblings.
 */
export function addServiceBusSubscriptionHealthCheck(
  builder: IHealthCheckBuilder,
  client: ServiceBusClient,
  topicName: string,
  subscriptionName: string,
): IHealthCheckBuilder {
  return addHealthCheckFactory(builder, new ServiceBusHealthCheckFactory(client, topicName, subscriptionName));
}
