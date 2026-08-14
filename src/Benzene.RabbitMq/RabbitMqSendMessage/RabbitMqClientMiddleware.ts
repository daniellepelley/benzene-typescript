/** Port of Benzene.RabbitMq.RabbitMqSendMessage.RabbitMqClientMiddleware. */
import { IMiddleware, NextFunc } from '@benzenejs/abstractions-middleware';
import { Channel } from 'amqplib';
import { RabbitMqSendMessageContext } from './RabbitMqSendMessageContext';

/**
 * The terminal middleware at the bottom of an outbound RabbitMQ pipeline: publishes the
 * {@link RabbitMqSendMessageContext} to its exchange/routing key via the shared amqplib `Channel`,
 * forwarding the Benzene headers onto the message properties.
 *
 * SDK-MAPPING BEND: C# awaits `IChannel.BasicPublishAsync(exchange, routingKey, mandatory, properties,
 * body)` (RabbitMQ.Client v7's async publish). amqplib's `Channel.publish(exchange, routingKey, content,
 * options)` is synchronous (its boolean return is write-buffer backpressure, not a failure), so the
 * middleware calls it and — matching the C#, which sets `Published = true` unconditionally after the
 * await — marks the context published. The C# `BasicProperties { Headers, Persistent }` map to amqplib's
 * publish `options.headers` / `options.persistent` (+ `options.mandatory`).
 */
export class RabbitMqClientMiddleware implements IMiddleware<RabbitMqSendMessageContext> {
  readonly name = 'RabbitMqClientMiddleware';

  /**
   * @param channel The RabbitMQ channel to publish on.
   * @param mandatory When `true`, an unroutable message (no queue bound for the routing key) is returned
   * by the broker rather than silently dropped. Defaults to `false`.
   * @param persistent When `true` (the default), the message is published persistently (delivery mode 2),
   * so a message on a durable queue survives a broker restart.
   */
  constructor(
    private readonly channel: Channel,
    private readonly mandatory = false,
    private readonly persistent = true,
  ) {}

  handleAsync(context: RabbitMqSendMessageContext, _next: NextFunc): Promise<void> {
    this.channel.publish(context.exchange, context.routingKey, context.body, {
      headers: context.headers,
      persistent: this.persistent,
      mandatory: this.mandatory,
    });
    context.published = true;
    return Promise.resolve();
  }
}
