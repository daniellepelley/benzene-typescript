/** Port of Benzene.RabbitMq.RabbitMqSendMessage.RabbitMqContextConverter&lt;T&gt;. */
import { ISerializer, VoidResult } from '@benzenejs/abstractions';
import { IBenzeneClientContext } from '@benzenejs/abstractions-messages';
import { IContextConverter } from '@benzenejs/abstractions-middleware';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { BenzeneResult } from '@benzenejs/results';
import { RabbitMqConstants } from '../RabbitMqConstants';
import { RabbitMqSendMessageContext } from './RabbitMqSendMessageContext';

/**
 * Converts a Benzene outbound client request (`IBenzeneClientContext<T, VoidResult>`) into a
 * {@link RabbitMqSendMessageContext}, and maps the publish outcome back to a Benzene status. The
 * request's topic becomes the AMQP routing key and is also carried as a topic header, so a Benzene
 * RabbitMQ consumer routes by header (portable) with the routing key as the idiomatic fallback. The
 * Benzene header dictionary is forwarded onto the message properties (UTF-8 encoded) so
 * correlation/trace/version headers reach the wire — matching Kafka's header forwarding.
 */
export class RabbitMqContextConverter<T>
  implements IContextConverter<IBenzeneClientContext<T, VoidResult>, RabbitMqSendMessageContext>
{
  private readonly serializer: ISerializer;
  private readonly exchange: string;
  private readonly topicHeaderKey: string;

  /**
   * @param serializer The serializer used to encode the message body (defaults to `JsonSerializer`).
   * @param exchange The exchange to publish to. Empty string (the default) uses the default exchange,
   * where the routing key is the target queue name.
   * @param topicHeaderKey The message-property header the topic is written to (defaults to
   * {@link RabbitMqConstants.DefaultTopicHeader}); pass a different key to publish for a consumer that
   * routes on another header.
   */
  constructor(
    serializer?: ISerializer,
    exchange = '',
    topicHeaderKey: string = RabbitMqConstants.DefaultTopicHeader,
  ) {
    this.serializer = serializer ?? new JsonSerializer();
    this.exchange = exchange;
    this.topicHeaderKey = topicHeaderKey;
  }

  createRequestAsync(
    contextIn: IBenzeneClientContext<T, VoidResult>,
  ): Promise<RabbitMqSendMessageContext> {
    const headers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(contextIn.request.headers)) {
      headers[key] = Buffer.from(value ?? '', 'utf8');
    }

    // Carry the topic as a header too, so a Benzene RabbitMQ consumer's header-first topic getter
    // round-trips it regardless of the routing key the exchange binding uses.
    headers[this.topicHeaderKey] = Buffer.from(contextIn.request.topic, 'utf8');

    const body = Buffer.from(this.serializer.serialize(contextIn.request.message), 'utf8');

    return Promise.resolve(
      new RabbitMqSendMessageContext(this.exchange, contextIn.request.topic, body, headers),
    );
  }

  mapResponseAsync(
    contextIn: IBenzeneClientContext<T, VoidResult>,
    contextOut: RabbitMqSendMessageContext,
  ): Promise<void> {
    contextIn.response = contextOut.published
      ? BenzeneResult.accepted<VoidResult>()
      : BenzeneResult.serviceUnavailable<VoidResult>('RabbitMQ message was not published');
    return Promise.resolve();
  }
}
