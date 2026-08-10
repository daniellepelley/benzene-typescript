import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { ITransportInfo, TransportNames } from '@benzene/abstractions-message-handlers';
import { addBenzeneMessageHandling, TransportInfo } from '@benzene/core-message-handlers';
import { InProcessDispatcherRegistry } from './InProcessDispatcherRegistry';
import { InProcessMessagingAlreadyRegisteredException } from './InProcessMessagingAlreadyRegisteredException';
import { InProcessMessagingBuilder } from './InProcessMessagingBuilder';

/**
 * Registers every named in-process pipeline within a single call - the shape for a service with more
 * than one in-process module, each with its own handlers and its own middleware stack. Route an
 * outbound topic to a given module with `useInProcess(app, name)`.
 * Port of Benzene.Clients.InProcess.DependencyInjectionExtensions.AddInProcessMessaging.
 *
 * PORT DIVERGENCE from .NET: the C# `AddInProcessMessaging` has two overloads - one taking
 * `Action<InProcessMessagingBuilder>` (many named pipelines), one taking
 * `Action<IMiddlewarePipelineBuilder<BenzeneMessageContext>>` (sugar for a single unnamed pipeline) -
 * resolved unambiguously at compile time by parameter type. TypeScript function overloads are
 * resolved the same way statically, but there is no runtime way to tell the two callback shapes
 * apart (both are just a one-argument function) inside a single implementation, and the port's own
 * convention for genuinely ambiguous overloads is to split by name rather than guess (see
 * `useMessageHandlersWithRouter` next to `useMessageHandlers`). Rather than add a second exported
 * name for a one-line convenience, this port ships **only** the many-pipelines form; the
 * single-pipeline case is `addInProcessMessaging(services, (registry) => registry.add(configure))` -
 * one extra `registry.add(...)` wrapper, not a second function to remember.
 *
 * @throws InProcessMessagingAlreadyRegisteredException `addInProcessMessaging` was already called on
 * this container - one call is the contract, not one call per module.
 *
 * @example
 * ```ts
 * // Several modules:
 * addInProcessMessaging(services, (registry) => registry
 *   .add('billing', (pipeline) => useMessageHandlers(pipeline, ChargeCardHandler))
 *   .add('shipping', (pipeline) => useMessageHandlers(pipeline, ReserveStockHandler)));
 *
 * addOutboundRouting(services, (routing) => routing
 *   .route('billing:charge', (pipeline) => useInProcess(pipeline, 'billing'))
 *   .route('shipping:reserve', (pipeline) => useInProcess(pipeline, 'shipping')));
 *
 * // A single module - one extra registry.add(...) wrapper vs. a bare pipeline callback:
 * addInProcessMessaging(services, (registry) => registry.add(
 *   (pipeline) => useMessageHandlers(pipeline, OrderCreatedHandler)));
 *
 * addOutboundRouting(services, (routing) => routing
 *   .route('order:created', (pipeline) => useInProcess(pipeline)));
 * ```
 */
export function addInProcessMessaging(
  services: IBenzeneServiceContainer,
  configure: (registry: InProcessMessagingBuilder) => void,
): IBenzeneServiceContainer {
  if (services.isTypeRegistered(InProcessDispatcherRegistry)) {
    throw new InProcessMessagingAlreadyRegisteredException();
  }

  // Reuses the same BenzeneMessage request/response plumbing addBenzeneMessage(HTTP/Lambda) relies on,
  // but deliberately skips addBenzeneMessage()'s ITransportInfo("benzene") registration: a service
  // that only dispatches in-process never exposes that wire endpoint, and advertising it anyway would
  // misrepresent the service's transport surface to the mesh/descriptor.
  addBenzeneMessageHandling(services);

  const builder = new InProcessMessagingBuilder(services);
  configure(builder);
  const dispatchersByName = builder.build();

  services.addSingletonInstance(InProcessDispatcherRegistry, new InProcessDispatcherRegistry(dispatchersByName));
  services.addSingletonFactory(ITransportInfo, () => new TransportInfo(TransportNames.InProcess));

  return services;
}
