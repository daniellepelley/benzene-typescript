/** Port of Benzene.Azure.Function.EventGrid.EventGridMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { Topic } from '@benzenejs/core-messages';
import { EventGridContext } from './EventGridContext';

/**
 * Extracts the message topic from an Event Grid event's `eventType` (e.g.
 * `Microsoft.Storage.BlobCreated`, or your own custom event type), so events route to a message handler
 * declaring that topic — the same shape as `@benzenejs/aws-lambda-s3` routing on the S3 event name.
 *
 * FAITHFUL to the C#: returns `undefined` (C# `null`) when the event carries no event type, so the
 * `PresetTopicMessageTopicGetter` this getter is wrapped in by `addEventGrid` can override per pipeline.
 */
export class EventGridMessageTopicGetter implements IMessageTopicGetter<EventGridContext> {
  getTopic(context: EventGridContext): ITopic | undefined {
    return context.event.eventType === undefined ? undefined : new Topic(context.event.eventType);
  }
}
