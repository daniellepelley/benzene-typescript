/** Port of Benzene.HealthChecks.Azure.ServiceBus.ServiceBusHealthCheckFactory. */
import { ServiceBusClient } from '@azure/service-bus';
import { IServiceResolver } from '@benzene/abstractions';
import { IHealthCheck, IHealthCheckFactory } from '@benzene/health-checks-core';
import { ServiceBusHealthCheck } from './ServiceBusHealthCheck';

/**
 * Builds a {@link ServiceBusHealthCheck} for a fixed queue or topic subscription.
 *
 * PORT DIVERGENCE: the C# factory resolves `ServiceBusClient` from the container in `Create`; the
 * TypeScript port has no DI token for the raw `@azure/service-bus` client (matching the
 * `@benzene/clients-azure-*` and `@benzene/health-checks-dynamodb` convention), so the
 * `ServiceBusClient` is supplied to the factory directly and `create`'s resolver is unused.
 */
export class ServiceBusHealthCheckFactory implements IHealthCheckFactory {
  private readonly queueName?: string;
  private readonly topicName?: string;
  private readonly subscriptionName?: string;

  /**
   * Builds a check for a queue.
   * @param client The Service Bus client the resulting health check will peek with.
   * @param queueName The queue the resulting health check will peek.
   */
  constructor(client: ServiceBusClient, queueName: string);
  /**
   * Builds a check for a topic subscription.
   * @param client The Service Bus client the resulting health check will peek with.
   * @param topicName The topic the subscription belongs to.
   * @param subscriptionName The subscription the resulting health check will peek.
   */
  constructor(client: ServiceBusClient, topicName: string, subscriptionName: string);
  constructor(
    private readonly client: ServiceBusClient,
    nameOrTopic: string,
    subscriptionName?: string,
  ) {
    if (subscriptionName === undefined) {
      this.queueName = nameOrTopic;
    } else {
      this.topicName = nameOrTopic;
      this.subscriptionName = subscriptionName;
    }
  }

  create(_resolver: IServiceResolver): IHealthCheck {
    return this.queueName !== undefined
      ? new ServiceBusHealthCheck(this.client, this.queueName)
      : new ServiceBusHealthCheck(this.client, this.topicName!, this.subscriptionName!);
  }
}
