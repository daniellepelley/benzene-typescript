/** Port of Benzene.Azure.ServiceBus.IServiceBusClientFactory. */
import { ServiceBusClient } from '@azure/service-bus';

/**
 * Creates the underlying {@link ServiceBusClient} used by {@link BenzeneServiceBusWorker} to consume an
 * entity. Lets the caller decide how the client is authenticated (connection string, Managed Identity
 * via a `TokenCredential`, emulator, …) without the worker prescribing it.
 *
 * PORTING NOTE: like `ISqsClientFactory`, this is passed directly to `useServiceBus` (not resolved from
 * the container), so — matching the C# `AddServiceBusConsumer`, which doesn't register it either — it
 * declares no `ServiceToken`.
 */
export interface IServiceBusClientFactory {
  /** Creates a {@link ServiceBusClient}. The worker disposes the returned client when it stops. */
  create(): ServiceBusClient;
}
