/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { findMetadataValue, Topic } from '@benzenejs/core-messages';
import { ServiceBusContext } from './ServiceBusContext';

/**
 * Extracts the message topic from a Service Bus message's `"topic"` application property.
 *
 * Service Bus has no native per-message "topic" field in the Benzene sense (a Service Bus
 * topic/subscription is a routing destination configured on the trigger, not a per-message property),
 * so the routing topic comes from a custom `"topic"` application property set by the sender — the same
 * convention as SQS/SNS. MESSAGE-TYPE ADAPTATION: C# `Message.ApplicationProperties.TryGetValue("topic",
 * out var value) ? value as string : null` becomes a read of `message.applicationProperties?.["topic"]`,
 * coerced to a string only when it is one (C# `as string` yields null for a non-string). A missing
 * property yields `undefined`, which `Topic` maps to the `<missing>` id (C# `Constants.Missing`).
 */
export class ServiceBusMessageTopicGetter implements IMessageTopicGetter<ServiceBusContext> {
  /** The default application property the topic is read from - the spec's reserved `topic` (wire-contracts.md §2). */
  static readonly DefaultTopicProperty = 'topic';

  /**
   * @param topicPropertyKey The application property the topic is read from - {@link DefaultTopicProperty}
   * unless the service renamed it (wire-contracts.md §2: reserved names are configurable).
   */
  constructor(private readonly topicPropertyKey: string = ServiceBusMessageTopicGetter.DefaultTopicProperty) {}

  getTopic(context: ServiceBusContext): ITopic | undefined {
    return new Topic(this.getTopicProperty(context));
  }

  private getTopicProperty(context: ServiceBusContext): string | undefined {
    // Matched case-insensitively: header keys are case-insensitive on read (wire-contracts.md).
    const value = findMetadataValue(context.message.applicationProperties, this.topicPropertyKey);
    return typeof value === 'string' ? value : undefined;
  }
}
