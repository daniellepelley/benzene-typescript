/** Port of Benzene.Azure.Function.EventGrid (barrel). */
export * from './EventGridTriggerEvent';
export * from './EventGridContext';
export * from './EventGridMessageTopicGetter';
export * from './EventGridMessageBodyGetter';
export * from './EventGridMessageHeadersGetter';
export * from './EventGridMessageHandlerResultSetter';
export * from './EventGridMessageProcessingException';
export * from './EventGridOptions';
export * from './EventGridApplication';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// MESSAGE-TYPE ADAPTATION: `Azure.Messaging.EventGrid` is NOT used — the event payload rides as a
// parsed-JSON value (C# `JsonElement?` -> `unknown`), so — exactly as the .NET original — the port keeps
// a bespoke dependency-free `EventGridTriggerEvent` whose `parse` covers both wire schemas (the Event
// Grid schema and CloudEvents 1.0, detected by `specversion`). Events route BY EVENT TYPE
// (`eventType`/`type`) via `EventGridMessageTopicGetter` (preset-wrapped), the body is the event's
// `data` payload, and the headers are the envelope (`id`/`subject`/`source`). Like `addQueueStorage`/
// `addKafka`, request/response mapping comes from `addContextItems` (via `useMessageHandlers`), so no
// request mapper is registered here.
//
// FAILURE HANDLING: `raiseOnFailureStatus` defaults to TRUE (safe-by-default) — a handler's non-exception
// failure result is escalated into a thrown `EventGridMessageProcessingException` so Event Grid's own
// retry/dead-letter policy engages, exactly as C#. `EventGridBatchApplication` fans the batch out via the
// already-ported `BoundedFanOut.whenAllAsync` so `maxDegreeOfParallelism` optionally caps concurrency.
//
// DEFERRED: EventGridRegistrations.cs (registration diagnostics via RegistrationsBase / RegistrationCheck)
// — the same registration-diagnostics surface deferred for the AWS SqsRegistrations and the Azure
// ServiceBusRegistrations. Also deferred: the `BenzeneEventGridTriggerAttribute` (a source-generator
// `[assembly:]` declaration with no TypeScript counterpart), the host-neutral
// `useEventGrid(IBenzeneApplicationBuilder, ...)` overload, and the C# `name` discriminator for multiple
// Event Grid triggers (the ported `IAzureFunctionAppBuilder.add` takes no name).
