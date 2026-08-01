/**
 * Test helpers for the standalone RabbitMQ consumer worker (`@benzene/rabbitmq`): boot a real `StartUp`
 * in-memory with `benzeneTestHost(StartUp)` + `buildRabbitMqWorkerHost(...)`, then push native
 * `ConsumeMessage` deliveries (built from a `messageBuilder(...)` via `asRabbitMqBenzeneMessage(...)`)
 * through the real consumer pipeline with `host.handleAsync(...)` — no broker, no credentials.
 *
 * Port of Benzene.RabbitMq.TestHelpers.
 */
export * from './RabbitMqBenzeneTestHost';
export * from './BenzeneTestHostExtensions';
export * from './MessageBuilderExtensions';
