/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { RabbitMqConstants } from '../RabbitMqConstants';
import { RabbitMqContext } from './RabbitMqContext';

/**
 * Extracts the message topic from a RabbitMQ delivery's topic header, falling back to the AMQP routing
 * key when that header isn't present.
 *
 * The header is the portable choice — it matches how every other Benzene queue transport
 * (SQS/SNS/Service Bus/PubSub) carries the topic, so a message published by a Benzene client round-trips
 * unchanged. The routing-key fallback lets a non-Benzene producer (which won't set a `"topic"` header)
 * still route by its natural RabbitMQ routing key. When neither yields a value, `Topic` maps the topic id
 * to the `<missing>` sentinel (C# `Constants.Missing`), the same as the other consumer packages. Wrap this
 * in `PresetTopicMessageTopicGetter` (as `addRabbitMqConsumer` does) to honour `.usePresetTopic(...)`.
 *
 * MESSAGE-TYPE ADAPTATION: C# reads `BasicProperties.Headers` (values as `byte[]`, decoded to UTF-8, with
 * raw strings accepted). amqplib exposes `message.properties.headers` (a plain object); a string-valued
 * header passes through, a `Buffer`-valued one is UTF-8 decoded, and the routing key comes from
 * `message.fields.routingKey`.
 */
export class RabbitMqMessageTopicGetter implements IMessageTopicGetter<RabbitMqContext> {
  private readonly topicHeaderKey: string;

  /**
   * Initializes a new instance that reads the topic from the given header key, falling back to the AMQP
   * routing key.
   *
   * @param topicHeaderKey The message-property header the topic is carried on. Defaults to
   *   {@link RabbitMqConstants.DefaultTopicHeader} (`"topic"`) — pass a different key to consume messages
   *   a non-Benzene producer routes on another header, without writing a custom topic getter.
   */
  constructor(topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader) {
    this.topicHeaderKey = topicHeaderKey;
  }

  getTopic(context: RabbitMqContext): ITopic | undefined {
    return new Topic(this.getTopicHeader(context) ?? context.message.fields.routingKey);
  }

  private getTopicHeader(context: RabbitMqContext): string | undefined {
    const headers = context.message.properties.headers;
    if (headers === undefined || headers === null) {
      return undefined;
    }
    const value: unknown = headers[this.topicHeaderKey];
    if (value === undefined || value === null) {
      return undefined;
    }
    // A client may set the topic header as a raw string; RabbitMQ also carries header values as byte[].
    if (typeof value === 'string') {
      return value;
    }
    if (Buffer.isBuffer(value)) {
      return value.toString('utf8');
    }
    return String(value);
  }
}
