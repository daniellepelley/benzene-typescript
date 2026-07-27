/**
 * Port of Benzene.Azure.EventHub — the standalone (non-Functions) Azure Event Hubs consumer worker.
 *
 * `useEventHub(workerStartup, config, clientFactory, action)` adds a long-running
 * {@link BenzeneEventHubWorker} that consumes an Event Hub via `@azure/event-hubs` and runs each event
 * through a Benzene middleware pipeline (transport `"event-hub"`), checkpointing per partition every
 * `checkpointInterval` successfully handled events. Intended for `@benzene/self-host` workers rather than
 * Azure Functions (for an Event Hub trigger, use `@benzene/azure-function-event-hub`).
 *
 * PORTING NOTE: .NET's `EventProcessorClient` maps to a JS `EventHubConsumerClient` (built with a
 * `CheckpointStore`) + `subscribe(...)`; the per-event `ProcessEventAsync` becomes a per-partition
 * `processEvents` batch handler (still sequential per partition). `CancellationToken` → optional
 * `AbortSignal`.
 */
export * from './BenzeneEventHubConfig';
export * from './BenzeneEventHubWorker';
export * from './BenzeneInvocationExtensions';
export * from './EventHubConsumerApplication';
export * from './EventHubConsumerContext';
export * from './EventHubConsumerMessageBodyGetter';
export * from './EventHubConsumerMessageHandlerResultSetter';
export * from './EventHubConsumerMessageHeadersGetter';
export * from './EventHubConsumerMessageTopicGetter';
export * from './EventHubMessageProcessingException';
export * from './EventProcessorClientFactory';
export * from './IEventProcessorClientFactory';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
