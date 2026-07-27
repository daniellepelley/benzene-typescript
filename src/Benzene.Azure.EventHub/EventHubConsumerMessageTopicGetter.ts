/** Port of Benzene.Azure.EventHub.EventHubConsumerMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { EventHubConsumerContext } from './EventHubConsumerContext';

/**
 * Extracts the message topic from an event's topic property.
 *
 * Event Hubs has no native per-event "topic" field in the Benzene sense, so the routing topic comes from
 * a configurable event property set by the sender (default `"topic"`). MESSAGE-TYPE ADAPTATION: C#
 * `EventData.Properties.TryGetValue(key, out var value) ? value as string : null` becomes a read of
 * `eventData.properties?.[key]`, coerced to a string only when it is one (C# `as string` yields null for
 * a non-string). A missing property yields `undefined`, which `Topic` maps to the `<missing>` id.
 */
export class EventHubConsumerMessageTopicGetter
  implements IMessageTopicGetter<EventHubConsumerContext>
{
  /**
   * The default event-property key the topic is read from. A single default, not a hard-coded value —
   * pass a different key (or via `BenzeneEventHubConfig.topicPropertyKey` /
   * `addEventHubConsumer(topicPropertyKey)`) to consume events a non-Benzene producer routes on another
   * property.
   */
  static readonly DefaultTopicProperty = 'topic';

  constructor(
    private readonly topicPropertyKey: string = EventHubConsumerMessageTopicGetter.DefaultTopicProperty,
  ) {}

  getTopic(context: EventHubConsumerContext): ITopic | undefined {
    return new Topic(this.getTopicProperty(context));
  }

  private getTopicProperty(context: EventHubConsumerContext): string | undefined {
    const value = context.eventData.properties?.[this.topicPropertyKey];
    return typeof value === 'string' ? value : undefined;
  }
}
