/**
 * Test helpers for the standalone (non-Functions) Azure Event Hub consumer worker
 * (`@benzene/azure-event-hub`): boot a real `StartUp` in-memory with
 * `benzeneTestHost(StartUp)` + `buildEventHubWorkerHost(...)`, then push native `ReceivedEventData`
 * (built from a `messageBuilder(...)` via `asEventHubBenzeneMessage(...)`) through the real consumer
 * pipeline with `host.handleAsync(...)` — no hub, no credentials.
 *
 * Port of Benzene.Azure.EventHub.TestHelpers.
 */
export * from './EventHubWorkerBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './MessageBuilderExtensions';
