/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerApplication. */
import { ServiceBusReceivedMessage } from '@azure/service-bus';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { TransportNames } from '@benzene/abstractions-message-handlers';
import { TransportMiddlewarePipeline } from '@benzene/core-message-handlers';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';
import { ServiceBusSettlementDecision } from './ServiceBusSettlementDecision';
import { ServiceBusSettlementHolder } from './ServiceBusSettlementHolder';

/**
 * Processes a single received Service Bus message by mapping it to a {@link ServiceBusConsumerContext}
 * and running it through the middleware pipeline in its own service scope, tagging the transport as
 * `"service-bus"` for the duration. Returns a {@link ServiceBusSettlementDecision} carrying the
 * handler's recorded result and any explicit settlement the handler requested via
 * {@link ServiceBusSettlementHolder}, which {@link BenzeneServiceBusWorker} reads for
 * `ServiceBusConsumerAckMode.Explicit`.
 *
 * Owns its own DI scope (rather than extending a base application) so it can resolve the scoped
 * settlement holder the handler mutated — the worker runs outside that scope and can't read it directly.
 * The scope is disposed once the decision has been extracted.
 */
export class ServiceBusConsumerApplication {
  private readonly pipeline: IMiddlewarePipeline<ServiceBusConsumerContext>;

  constructor(pipeline: IMiddlewarePipeline<ServiceBusConsumerContext>) {
    this.pipeline = new TransportMiddlewarePipeline<ServiceBusConsumerContext>(
      TransportNames.ServiceBus,
      pipeline,
    );
  }

  /**
   * Runs the message through the pipeline in a fresh scope and returns the settlement decision.
   *
   * DIVERGENCE: C# seeds the scope with the delivery's `CancellationToken` (`SeedCancellationToken`).
   * The port has no ambient cancellation-token DI seam yet (see the TCP health-check note in the
   * README), so the token is accepted for signature parity but not threaded into the scope.
   */
  async handleAsync(
    message: ServiceBusReceivedMessage,
    serviceResolverFactory: IServiceResolverFactory,
    _cancellationToken?: AbortSignal,
  ): Promise<ServiceBusSettlementDecision> {
    const context = ServiceBusConsumerContext.createInstance(message);
    const serviceResolver = serviceResolverFactory.createScope();
    try {
      await this.pipeline.handleAsync(context, serviceResolver);

      const settlement = serviceResolver.tryGetService(ServiceBusSettlementHolder);
      return new ServiceBusSettlementDecision(context.messageResult, settlement);
    } finally {
      if (serviceResolver.disposeAsync) {
        await serviceResolver.disposeAsync();
      } else {
        serviceResolver.dispose();
      }
    }
  }
}
