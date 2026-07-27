/** Port of Benzene.Kafka.Core.Kafka.KafkaMessageContextConverter&lt;TContext&gt;. */
import { IBenzeneResponseAdapter, IMessageHandlerResultSetter } from '@benzene/abstractions-message-handlers';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IContextConverter } from '@benzene/abstractions-middleware';
import { MessageHandlerDefinition, MessageHandlerResult } from '@benzene/core-message-handlers';
import { Topic } from '@benzene/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { Message } from 'kafkajs';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

// The routing-topic header key. The outbound topic is set explicitly from the topic getter, so a "topic"
// carried in the inbound message's headers must NOT be copied onto the produced message: a Benzene
// SQS/SNS source surfaces its routing topic as a header, and forwarding it here would re-route the
// produced message to the consumed topic — an infinite loop if this service consumes it.
const TopicHeaderKey = 'topic';

/**
 * Converts an arbitrary handled-message context (`TContext`) into a {@link KafkaSendMessageContext} using
 * the registered topic/body/headers getters — the forwarding converter for producing to Kafka off the
 * back of a consumed message. On the way back it reflects success onto the source context via the
 * response adapter (if present) or the message-handler result setter.
 */
export class KafkaMessageContextConverter<TContext>
  implements IContextConverter<TContext, KafkaSendMessageContext>
{
  constructor(
    private readonly messageTopicGetter: IMessageTopicGetter<TContext>,
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    private readonly messageHeadersGetter: IMessageHeadersGetter<TContext>,
    private readonly messageHandlerResultSetter: IMessageHandlerResultSetter<TContext>,
    private readonly benzeneResponseAdapter: IBenzeneResponseAdapter<TContext> | undefined,
  ) {}

  createRequestAsync(contextIn: TContext): Promise<KafkaSendMessageContext> {
    const topic = this.messageTopicGetter.getTopic(contextIn);
    if (topic === undefined) {
      throw new Error(
        'IMessageTopicGetter returned no topic; a Kafka message cannot be produced without one.',
      );
    }

    // Forward headers onto the produced message, excluding the routing-topic key (see TopicHeaderKey) so
    // the inbound topic can't leak onto the outbound message and re-route it to the topic being consumed.
    const headers: Record<string, Buffer> = {};
    const messageHeaders = this.messageHeadersGetter.getHeaders(contextIn);
    if (messageHeaders !== undefined) {
      for (const [key, value] of Object.entries(messageHeaders)) {
        if (key.toLowerCase() === TopicHeaderKey) {
          continue;
        }
        headers[key] = Buffer.from(value ?? '', 'utf8');
      }
    }

    // A null body is a legitimate Kafka value (e.g. a tombstone record on a compacted topic), so an
    // absent body maps to `null` rather than an empty string.
    const message: Message = {
      value: this.messageBodyGetter.getBody(contextIn) ?? null,
      headers,
    };

    return Promise.resolve(new KafkaSendMessageContext(topic.id, message));
  }

  mapResponseAsync(contextIn: TContext, contextOut: KafkaSendMessageContext): Promise<void> {
    if (this.benzeneResponseAdapter !== undefined) {
      this.benzeneResponseAdapter.setStatusCode(contextIn, BenzeneResultStatus.ok);
      return Promise.resolve();
    }

    return this.messageHandlerResultSetter.setResultAsync(
      contextIn,
      new MessageHandlerResult(
        new Topic(contextOut.topic),
        MessageHandlerDefinition.empty(),
        BenzeneResult.set(BenzeneResultStatus.ok),
      ),
    );
  }
}
