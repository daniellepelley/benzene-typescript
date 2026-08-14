/** Port of Benzene.Azure.ServiceBus.ServiceBusConsumerMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { ServiceBusConsumerContext } from './ServiceBusConsumerContext';

/**
 * Extracts the message topic from a Service Bus message's topic application property.
 *
 * Service Bus has no native per-message "topic" field in the Benzene sense, so the routing topic comes
 * from a configurable application property set by the sender (default `"topic"`). MESSAGE-TYPE
 * ADAPTATION: C# `Message.ApplicationProperties.TryGetValue(key, out var value) ? value as string : null`
 * becomes a read of `message.applicationProperties?.[key]`, coerced to a string only when it is one (C#
 * `as string` yields null for a non-string). A missing property yields `undefined`, which `Topic` maps
 * to the `<missing>` id (C# `Constants.Missing`).
 */
export class ServiceBusConsumerMessageTopicGetter
  implements IMessageTopicGetter<ServiceBusConsumerContext>
{
  /**
   * The default application-property key the topic is read from. A single default, not a hard-coded
   * value — pass a different key (or via `BenzeneServiceBusConfig.topicPropertyKey` /
   * `addServiceBusConsumer(topicPropertyKey)`) to consume messages a non-Benzene producer routes on
   * another application property.
   */
  static readonly DefaultTopicProperty = 'topic';

  constructor(
    private readonly topicPropertyKey: string = ServiceBusConsumerMessageTopicGetter.DefaultTopicProperty,
  ) {}

  getTopic(context: ServiceBusConsumerContext): ITopic | undefined {
    return new Topic(this.getTopicProperty(context));
  }

  private getTopicProperty(context: ServiceBusConsumerContext): string | undefined {
    const value = context.message.applicationProperties?.[this.topicPropertyKey];
    return typeof value === 'string' ? value : undefined;
  }
}
