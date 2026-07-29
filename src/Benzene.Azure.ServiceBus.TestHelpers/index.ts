/**
 * Test helpers for the standalone (non-Functions) Azure Service Bus consumer worker
 * (`@benzene/azure-service-bus`): boot a real `StartUp` in-memory with
 * `benzeneTestHost(StartUp)` + `buildServiceBusWorkerHost(...)`, then push native
 * `ServiceBusReceivedMessage`s (built from a `messageBuilder(...)` via `asAzureServiceBusMessage(...)`)
 * through the real consumer pipeline with `host.handleAsync(...)` — no broker, no credentials.
 *
 * Port of Benzene.Azure.ServiceBus.TestHelpers.
 */
export * from './ServiceBusWorkerBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './MessageBuilderExtensions';
