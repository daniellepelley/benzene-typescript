/** Port of Benzene.Kafka.Core.Kafka.KafkaSendMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { KafkaSendMessageContext } from './KafkaSendMessageContext';

/**
 * Reads the routing topic off a {@link KafkaSendMessageContext} — the send-side counterpart of the
 * inbound `KafkaMessageTopicGetter`. The outbound context always carries its topic explicitly, so the
 * getter simply wraps it in a `Topic`.
 */
export class KafkaSendMessageTopicGetter implements IMessageTopicGetter<KafkaSendMessageContext> {
  getTopic(context: KafkaSendMessageContext): ITopic | undefined {
    return new Topic(context.topic);
  }
}
