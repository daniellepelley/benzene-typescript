/**
 * Port of Benzene.HealthChecks.Azure.ServiceBus — a non-destructive Azure Service Bus reachability
 * health check.
 *
 * `addServiceBusQueueHealthCheck(builder, client, queueName)` /
 * `addServiceBusSubscriptionHealthCheck(builder, client, topicName, subscriptionName)` register a check
 * that verifies the entity is reachable with a read-only `peekMessages` call (healthy on a successful
 * round-trip, a persistent failure on an authorization denial, transient otherwise), over a
 * caller-supplied `@azure/service-bus` `ServiceBusClient`.
 */
export * from './ServiceBusHealthCheck';
export * from './ServiceBusHealthCheckFactory';
export * from './Extensions';
