/** Port of Benzene.Azure.ServiceBus.TestHelpers.ServiceBusWorkerBenzeneTestHost. */
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IServiceResolverFactory } from '@benzenejs/abstractions';
import {
  ServiceBusConsumerApplication,
  ServiceBusSettlementDecision,
} from '@benzenejs/azure-service-bus';

/**
 * A test host that drives the Service Bus consumer pipeline a `StartUp` configured, without a running
 * broker. Built by {@link buildServiceBusWorkerHost}; push a message through it with
 * {@link ServiceBusWorkerBenzeneTestHost.handleAsync} (build one from a `messageBuilder(...)` via
 * `asAzureServiceBusMessage(...)`).
 *
 * IDIOM MAP: C# `IDisposable.Dispose` → `dispose()` (the port's disposal convention); the underlying
 * `handleAsync` keeps the documented `Async` suffix camelCased. Front door in
 * (`ServiceBusReceivedMessage`), native settlement decision out — assert on the mapped
 * {@link ServiceBusSettlementDecision} and on what a faked outbound client captured.
 */
export class ServiceBusWorkerBenzeneTestHost {
  constructor(
    private readonly application: ServiceBusConsumerApplication,
    private readonly serviceResolverFactory: IServiceResolverFactory,
  ) {}

  /**
   * Runs a message through the pipeline exactly as `BenzeneServiceBusWorker` would, returning the
   * settlement decision (the handler's result plus any explicit settlement override).
   * @param message The message to handle (typically built by `asAzureServiceBusMessage(...)`).
   * @returns The settlement decision.
   */
  handleAsync(message: ServiceBusReceivedMessage): Promise<ServiceBusSettlementDecision> {
    return this.application.handleAsync(message, this.serviceResolverFactory);
  }

  /** Disposes the resolver factory (and the service provider it owns). Port of C# `Dispose`. */
  dispose(): void {
    this.serviceResolverFactory.dispose();
  }
}
