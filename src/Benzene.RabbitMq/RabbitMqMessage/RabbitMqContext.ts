/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqContext. */
import { ConsumeMessage } from 'amqplib';
import { IHasMessageResult, IMessageResult } from '@benzenejs/abstractions-message-handlers';

/**
 * The middleware pipeline context for a single RabbitMQ delivery consumed by {@link RabbitMqWorker}.
 *
 * MESSAGE-TYPE ADAPTATION: .NET wraps `RabbitMQ.Client.Events.BasicDeliverEventArgs` (body, headers,
 * routing key, delivery tag). amqplib delivers each message to the `consume` callback as a
 * `ConsumeMessage` (`{ content, fields, properties }`), so this port wraps that directly — transport
 * shape only (context purity). Field mapping used by the getters/worker (.NET → amqplib):
 * `DeliverEventArgs.Body`→`message.content`, `.RoutingKey`→`message.fields.routingKey`,
 * `.Redelivered`→`message.fields.redelivered`, `.DeliveryTag`→`message.fields.deliveryTag`,
 * `.BasicProperties.Headers`→`message.properties.headers`.
 *
 * Implements `IHasMessageResult` so the worker can read the recorded result to decide the per-message
 * ack/nack under `RabbitMqAckMode.Explicit`; `undefined` (C# `null`) until a result is recorded.
 */
export class RabbitMqContext implements IHasMessageResult {
  private constructor(readonly message: ConsumeMessage) {}

  /** Creates a new context for a received delivery. Port of the C# `CreateInstance`. */
  static createInstance(message: ConsumeMessage): RabbitMqContext {
    return new RabbitMqContext(message);
  }

  /**
   * The result of handling this delivery. Set by `RabbitMqMessageHandlerResultSetter`; read by
   * `RabbitMqWorker` to decide ack vs nack under `RabbitMqAckMode.Explicit`. `undefined` (C# `null`)
   * until a result is recorded — e.g. a pipeline that short-circuited without setting one.
   */
  messageResult!: IMessageResult;
}
