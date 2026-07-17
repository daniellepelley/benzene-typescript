import { IGetTopic } from '@benzene/abstractions-messages';

/**
 * The default `IGetTopic`: returns an empty topic, leaving topic selection to the transport
 * middleware in the client pipeline.
 * Port of Benzene.Core.Messages.MessageSender.DefaultGetTopic.
 */
export class DefaultGetTopic implements IGetTopic {
  getTopic(): string {
    return '';
  }
}
