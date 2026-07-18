/** Port of Benzene.Azure.Function.ServiceBus.ServiceBusMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
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
  getTopic(context: ServiceBusContext): ITopic | undefined {
    return new Topic(ServiceBusMessageTopicGetter.getTopicProperty(context));
  }

  private static getTopicProperty(context: ServiceBusContext): string | undefined {
    const value = context.message.applicationProperties?.['topic'];
    return typeof value === 'string' ? value : undefined;
  }
}
