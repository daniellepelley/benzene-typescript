/** Port of Benzene.RabbitMq.IRabbitMqConnectionFactory. */
import { ChannelModel } from 'amqplib';

/**
 * The seam through which {@link RabbitMqWorker} obtains a RabbitMQ connection — mirroring the Kafka /
 * Service Bus client-factory seams ({@link IKafkaConsumerFactory}, {@link IServiceBusClientFactory}). The
 * caller owns how the connection is built (host, credentials, TLS, virtual host, automatic recovery); the
 * worker owns its channel and disposes both the channel and the connection on stop.
 *
 * MESSAGE-TYPE ADAPTATION: .NET's `RabbitMQ.Client` splits a `ConnectionFactory` (built by the caller)
 * from the `IConnection` it opens. amqplib has no factory object — `amqplib.connect(url)` returns a
 * `ChannelModel` (the object carrying `createChannel()`/`close()`; amqplib's own name for what other AMQP
 * clients call the connection). So this seam's `createConnectionAsync` returns that `ChannelModel`, and
 * the caller decides the URL/options it is opened from (see {@link RabbitMqConnectionFactory}).
 *
 * Like the SQS/Service Bus/Kafka factories, it is passed directly to `useRabbitMq` (not resolved from the
 * container), so it declares no `ServiceToken`.
 */
export interface IRabbitMqConnectionFactory {
  /**
   * Opens a new RabbitMQ connection.
   *
   * ADAPTATION — cancellation. C# `CreateConnectionAsync(CancellationToken)` maps to an optional
   * `AbortSignal` (amqplib's `connect` takes no cancellation source, so the signal is accepted for
   * signature parity but not threaded into the SDK).
   */
  createConnectionAsync(cancellationToken?: AbortSignal): Promise<ChannelModel>;
}
