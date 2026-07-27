/** Port of Benzene.Azure.Function.QueueStorage (barrel). */
export * from './QueueStorageMessage';
export * from './QueueStorageContext';
export * from './QueueStorageMessageBodyGetter';
export * from './QueueStorageMessageHeadersGetter';
export * from './QueueStorageMessageTopicGetter';
export * from './QueueStorageMessageHandlerResultSetter';
export * from './QueueStorageMessageProcessingException';
export * from './QueueStorageOptions';
export * from './QueueStorageApplication';
export * from './BenzeneMessageQueueStorageHandler';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// MESSAGE-TYPE ADAPTATION: `@azure/functions` exposes no dedicated queue-message type (the
// `storageQueue` trigger delivers the raw string), so — exactly as the .NET original — the port keeps
// a bespoke dependency-free `QueueStorageMessage` rather than depending on an SDK type. Like the Event
// Hub package (and unlike Service Bus/Kafka), a Queue Storage message has no transport property for a
// topic to ride on, so routing comes from a preset topic (`usePresetTopic`) or a Benzene envelope in
// the body (`useBenzeneMessage`, via `BenzeneMessageQueueStorageHandler`).
//
// DI-UNDER-ERASURE: because the envelope path nests a `BenzeneMessageContext` pipeline inside the
// `QueueStorageContext` one in a single container, `addQueueStorage` registers its transport getters with
// `tryAdd` and runs AFTER the pipeline `action`, so the inner `addBenzeneMessage` getters win under the
// shared erased token while the preset-topic path still gets the QueueStorage getters — see
// `DependencyInjectionExtensions.ts`. Request/response mapping comes from `addContextItems` (via
// `useMessageHandlers`), so — like `addKafka` — no request mapper is registered here.
//
// DEFERRED: QueueStorageRegistrations.cs (registration diagnostics via RegistrationsBase /
// RegistrationCheck) — the same registration-diagnostics surface deferred for the AWS SqsRegistrations
// and the Azure ServiceBusRegistrations. Also deferred: the `BenzeneQueueTriggerAttribute` (a
// source-generator declaration with no TypeScript counterpart), the `SuppressResponse()` call on the
// envelope path (the suppression primitive is not yet ported — same as Event Hub), the host-neutral
// `useQueueStorage(IBenzeneApplicationBuilder, ...)` overload, and the C# `name` discriminator for
// multiple queue triggers (the ported `IAzureFunctionAppBuilder.add` takes no name).
