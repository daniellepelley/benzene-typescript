/** Port of Benzene.RabbitMq.RabbitMqSendMessage.RabbitMqSendMessageContext. */

/**
 * The pipeline context for one outbound RabbitMQ publish: the exchange and routing key to publish to, the
 * serialized body, and the headers to carry on the message's properties. {@link published} records
 * whether the publish completed (set by `RabbitMqClientMiddleware`).
 *
 * SDK-MAPPING BEND: C# holds a `ReadOnlyMemory<byte> Body` and an `IDictionary<string, object?> Headers`
 * (placed on RabbitMQ.Client `BasicProperties`). amqplib takes the body as a `Buffer` and the headers as
 * a plain object on the publish `options.headers`, so `body` is a `Buffer` and `headers` is a
 * `Record<string, unknown>` (its values are UTF-8 `Buffer`s, matching the C# byte-encoded header values).
 */
export class RabbitMqSendMessageContext {
  /** Whether the publish completed successfully. Set by `RabbitMqClientMiddleware`. */
  published = false;

  /**
   * @param exchange The exchange to publish to (empty string for the default exchange).
   * @param routingKey The routing key (for the default exchange, the target queue name).
   * @param body The serialized message body.
   * @param headers The headers to place on the message's properties.
   */
  constructor(
    readonly exchange: string,
    readonly routingKey: string,
    readonly body: Buffer,
    readonly headers: Record<string, unknown>,
  ) {}
}
