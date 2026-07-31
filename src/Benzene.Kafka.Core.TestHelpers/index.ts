/**
 * Test helpers for the standalone Kafka consumer worker (`@benzene/kafka-core`): boot a real `StartUp`
 * in-memory with `benzeneTestHost(StartUp)` + `buildKafkaWorkerHost(...)`, then push native
 * `EachMessagePayload` records (built from a `messageBuilder(...)` via `asKafkaBenzeneMessage(...)`)
 * through the real consumer pipeline with `host.handleAsync(...)` — no broker, no credentials.
 *
 * Port of Benzene.Kafka.Core.TestHelpers.
 */
export * from './KafkaBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './MessageBuilderExtensions';
