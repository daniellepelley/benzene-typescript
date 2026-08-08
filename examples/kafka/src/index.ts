/**
 * `@benzene-example/kafka` — a standalone Kafka consumer worker (over `@benzene/kafka-core` on `kafkajs`)
 * hosting an order domain, plus the producer client that feeds it. Ported from the .NET
 * `Benzene.Examples.Kafka` (consumer worker + producer). See `README.md`.
 */
export * from './orderStore';
export * from './handlers';
export * from './startUp';
export * from './producer';
