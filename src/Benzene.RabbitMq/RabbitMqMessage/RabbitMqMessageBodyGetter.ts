/** Port of Benzene.RabbitMq.RabbitMqMessage.RabbitMqMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzenejs/abstractions-messages';
import { RabbitMqContext } from './RabbitMqContext';

/**
 * Extracts the message body from a RabbitMQ delivery, UTF-8 decoding the raw payload — the same
 * convention every other Benzene transport uses.
 *
 * MESSAGE-TYPE ADAPTATION: C# UTF-8 decodes `BasicProperties`' `Body.Span` (`byte[]`); amqplib delivers
 * the payload as `message.content` (a `Buffer`), UTF-8 decoded the same way.
 */
export class RabbitMqMessageBodyGetter implements IMessageBodyGetter<RabbitMqContext> {
  getBody(context: RabbitMqContext): string | undefined {
    return context.message.content.toString('utf8');
  }
}
