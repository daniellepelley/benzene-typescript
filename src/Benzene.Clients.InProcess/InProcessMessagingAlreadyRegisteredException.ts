/**
 * Thrown when `addInProcessMessaging(...)` is called a second time on the same container.
 * Port of Benzene.Clients.InProcess.InProcessMessagingAlreadyRegisteredException.
 *
 * Before named pipelines, a second call would silently shadow the first: registration is additive,
 * so which in-process dispatcher a route resolved would depend on registration order, and a module
 * registered by an earlier call could vanish from routing with no error anywhere. Rather than
 * retrofit a shared, cross-call registry to detect and merge repeat calls, this container abstraction
 * gives no way to fetch a previously-registered singleton *instance* back out during service
 * registration - only `isTypeRegistered` to check presence. So instead, one call is the contract:
 * every module's pipeline is added within that one call via `InProcessMessagingBuilder.add(name,
 * configure)`, mirroring how `OutboundRoutingBuilder.route` accumulates many topics inside one
 * `addOutboundRouting(...)` call.
 */
export class InProcessMessagingAlreadyRegisteredException extends Error {
  constructor() {
    super(
      'addInProcessMessaging(...) was already called on this container. Register every in-process ' +
        "module's pipeline within a single call: addInProcessMessaging(registry => " +
        "registry.add('billing', ...).add('shipping', ...)) - not one addInProcessMessaging(...) " +
        'call per module.',
    );
    this.name = 'InProcessMessagingAlreadyRegisteredException';
    Object.setPrototypeOf(this, InProcessMessagingAlreadyRegisteredException.prototype);
  }
}
