/** Port of Benzene.Azure.ServiceBus.ServiceBusClientFactory. */
import { ServiceBusClient } from '@azure/service-bus';
import { IServiceBusClientFactory } from './IServiceBusClientFactory';

/**
 * An {@link IServiceBusClientFactory} that returns the injected {@link ServiceBusClient} instance. The
 * caller builds the client (connection string, Managed Identity, emulator, …); the worker disposes it
 * on stop.
 */
export class ServiceBusClientFactory implements IServiceBusClientFactory {
  constructor(private readonly serviceBusClient: ServiceBusClient) {}

  create(): ServiceBusClient {
    return this.serviceBusClient;
  }
}
