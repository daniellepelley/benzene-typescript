/**
 * Port of the consumer-worker slice of Benzene.RabbitMq — the standalone, self-hosted RabbitMQ consumer
 * worker, on `amqplib`.
 *
 * `useRabbitMq(workerStartup, config, connectionFactory, action)` adds a long-running
 * {@link RabbitMqWorker} that consumes a queue via `amqplib` (`channel.consume(queue, onMessage, { noAck })`)
 * and runs each delivery through a Benzene middleware pipeline (transport `"rabbitmq"`), settling it per
 * {@link RabbitMqAckMode}. RabbitMQ is the first vendor-neutral, self-hosted broker in Benzene; intended
 * for `@benzene/self-host` workers (console, container, Kubernetes) rather than a cloud trigger.
 *
 * ACK POLICY — safe by default. {@link RabbitMqConfig.ackMode} defaults to {@link RabbitMqAckMode.Explicit}:
 * a delivery is `ack`ed on handler success and `nack`ed on a failure result **or** a thrown exception,
 * with requeue bounded to one retry (an already-redelivered failure is nacked without requeue so a poison
 * message can't hot-loop). {@link RabbitMqAckMode.AutoAck} (broker acks on dispatch) is available for
 * at-most-once, loss-tolerant workloads. Handlers must be idempotent, since redelivery can reprocess a
 * message.
 *
 * PORTING NOTES:
 * - .NET's `RabbitMQ.Client` v7 async API (`IConnection`/`IChannel`, `AsyncEventingBasicConsumer`,
 *   `BasicAck`/`BasicNack`) maps to `amqplib` (`ChannelModel`/`Channel`, `channel.consume`,
 *   `channel.ack`/`channel.nack`). The connection seam ({@link IRabbitMqConnectionFactory}) lets the
 *   caller build the connection (URL/auth/vhost/TLS), exactly like the Kafka/Service Bus client factories.
 * - `CancellationToken` → optional `AbortSignal`.
 *
 * The **outbound publish** slice IS ported (`RabbitMqSendMessage/`: `RabbitMqBenzeneMessageClient`,
 * `RabbitMqClientMiddleware`, `RabbitMqSendMessageContext`, `RabbitMqContextConverter`, and the
 * `useRabbitMqClient`/`useRabbitMq`/`useRabbitMqChannel` wiring) — see the exports below.
 *
 * DEFERRED from the C# package (documented in the README porting-conventions bullet):
 * - The **health-check** slice (`RabbitMqHealthCheck`, `RabbitMqHealthCheckExtensions`,
 *   `RabbitMqConnectionProvider`, and `UseRabbitMq`'s auto-wiring `healthCheck` flag) — the health-check
 *   domain is owned separately and out of scope for this port.
 */
export * from './IRabbitMqConnectionFactory';
export * from './RabbitMqConnectionFactory';
export * from './RabbitMqAckMode';
export * from './RabbitMqConfig';
export * from './RabbitMqConstants';
export * from './RabbitMqWorker';
export * from './RabbitMqMessage/RabbitMqApplication';
export * from './RabbitMqMessage/RabbitMqContext';
export * from './RabbitMqMessage/RabbitMqMessageBodyGetter';
export * from './RabbitMqMessage/RabbitMqMessageHandlerResultSetter';
export * from './RabbitMqMessage/RabbitMqMessageHeadersGetter';
export * from './RabbitMqMessage/RabbitMqMessageTopicGetter';
export * from './DependencyInjectionExtensions';
export * from './Extensions';

// Outbound publish (send-side) slice — port of the C# `RabbitMqSendMessage/` folder.
// `RabbitMqBenzeneMessageClient` is an `IBenzeneMessageClient` publishing via an amqplib `Channel`;
// `useRabbitMqClient`/`useRabbitMq`/`useRabbitMqChannel` wire the publish pipeline. See the README
// porting-conventions bullet (producer now ported). Renamed export to avoid a name clash with the
// consumer-side `Extensions` (`useRabbitMq` consumer worker) — the send-side extensions are re-exported
// individually below rather than via `export *`.
export * from './RabbitMqSendMessage/RabbitMqSendMessageContext';
export * from './RabbitMqSendMessage/RabbitMqContextConverter';
export * from './RabbitMqSendMessage/RabbitMqClientMiddleware';
export * from './RabbitMqSendMessage/RabbitMqBenzeneMessageClient';
export {
  useRabbitMqClient,
  useRabbitMq as useRabbitMqSend,
  useRabbitMqChannel,
} from './RabbitMqSendMessage/Extensions';
