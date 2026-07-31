/**
 * Port of the consumer-worker slice of Benzene.Kafka.Core — the standalone (non-trigger) Kafka consumer
 * worker, on `kafkajs`.
 *
 * `useKafka(workerStartup, config, consumerFactory, action)` adds a long-running
 * {@link BenzeneKafkaWorker} that consumes topics via `kafkajs` (`consumer.run({ eachMessage })`) and
 * runs each record through a Benzene middleware pipeline (transport `"kafka"`). Intended for
 * `@benzene/self-host` workers rather than a cloud trigger (for those, use `@benzene/aws-lambda-kafka` /
 * `@benzene/azure-function-kafka`).
 *
 * PORTING NOTE: .NET's synchronous `IConsumer.Consume()` poll loop + `BoundedConcurrentDispatcher` maps
 * to kafkajs's push-based `consumer.run({ eachMessage, partitionsConsumedConcurrently, autoCommit })`.
 * The generic `TKey`/`TValue` are erased (kafkajs delivers raw `Buffer` key/value). The outbound producer
 * IS ported (see the `Kafka/` exports below); the dead-letter/`DrainOnRevoke` and health-check slices of
 * the .NET package are **not** ported here — see the README porting-conventions bullet. `CancellationToken` → optional `AbortSignal`.
 */
export * from './BenzeneKafkaConfig';
export * from './BenzeneKafkaWorker';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
export * from './IKafkaConsumerFactory';
export * from './IKafkaAdminClientFactory';
export * from './KafkaHealthCheck';
export * from './KafkaHealthCheckExtensions';
export * from './KafkaMessage/BenzeneInvocationExtensions';
export * from './KafkaMessage/KafkaApplication';
export * from './KafkaMessage/KafkaMessageBodyGetter';
export * from './KafkaMessage/KafkaMessageHandlerResultSetter';
export * from './KafkaMessage/KafkaMessageHeadersGetter';
export * from './KafkaMessage/KafkaMessageTopicGetter';
export * from './KafkaMessage/KafkaRecordContext';

// Outbound producer (send-side) slice — port of the C# `Kafka/` folder. `KafkaBenzeneMessageClient` is
// an `IBenzeneMessageClient` producing via a kafkajs `Producer`; `useKafkaClient`/`useKafka`/`addSendKafka`
// wire the produce pipeline. See the README porting-conventions bullet (producer now ported).
export * from './Kafka/KafkaSendMessageContext';
export * from './Kafka/KafkaSendMessageTopicGetter';
export * from './Kafka/KafkaMessageBodyGetter';
export * from './Kafka/KafkaMessageHeadersGetter';
export * from './Kafka/KafkaContextConverter';
export * from './Kafka/KafkaMessageContextConverter';
export * from './Kafka/KafkaClientMiddleware';
export * from './Kafka/KafkaBenzeneMessageClient';
export * from './Kafka/DependencyInjectionExtensions';
// Renamed export to avoid a name clash with the consumer-side `Extensions` (which exports a `useKafka`
// worker helper) — the send-side `useKafka` is re-exported as `useKafkaSend`.
export { useKafkaClient, useKafka as useKafkaSend } from './Kafka/Extensions';
