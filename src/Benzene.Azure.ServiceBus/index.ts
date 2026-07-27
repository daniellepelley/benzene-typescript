/**
 * Port of Benzene.Azure.ServiceBus — the standalone (non-Functions) Azure Service Bus consumer worker.
 *
 * `useServiceBus(workerStartup, config, clientFactory, action)` adds a long-running
 * {@link BenzeneServiceBusWorker} that consumes a queue or topic subscription via `@azure/service-bus`
 * and runs each received message through a Benzene middleware pipeline (transport `"service-bus"`),
 * settling it per {@link ServiceBusConsumerAckMode}. Intended for `@benzene/self-host` workers rather
 * than Azure Functions (for a Service Bus trigger, use `@benzene/azure-function-service-bus`).
 *
 * PORTING NOTES: .NET's `ServiceBusProcessor` push model maps to a `ServiceBusReceiver.subscribe(...)`;
 * session consumption (`sessionsEnabled`) and the peek-based dependency health-check auto-wiring are
 * deferred (see the README roadmap and the per-symbol doc comments).
 */
export * from './BenzeneServiceBusConfig';
export * from './BenzeneServiceBusWorker';
export * from './IServiceBusClientFactory';
export * from './IServiceBusMessageSettler';
export * from './ServiceBusClientFactory';
export * from './ServiceBusConsumerAckMode';
export * from './ServiceBusConsumerApplication';
export * from './ServiceBusConsumerContext';
export * from './ServiceBusConsumerMessageBodyGetter';
export * from './ServiceBusConsumerMessageHandlerResultSetter';
export * from './ServiceBusConsumerMessageHeadersGetter';
export * from './ServiceBusConsumerMessageTopicGetter';
export * from './ServiceBusSettlement';
export * from './ServiceBusSettlementDecision';
export * from './ServiceBusSettlementHolder';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
