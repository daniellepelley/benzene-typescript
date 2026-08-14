/** Port of Benzene.Azure.Function.QueueStorage.QueueStorageMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzenejs/abstractions-message-handlers';
import { ITopic } from '@benzenejs/abstractions-messages';
import { QueueStorageContext } from './QueueStorageContext';

/**
 * The transport's own topic getter for Queue Storage — which always returns `undefined` (C# `null`),
 * because a Queue Storage message carries no properties/attributes a topic could ride on (unlike
 * Service Bus application properties or Kafka topics); the body is the entire message. Routing
 * therefore comes from either a preset topic (`usePresetTopic(...)`, via the
 * `PresetTopicMessageTopicGetter` this getter is wrapped in by `addQueueStorage`) or a Benzene
 * message envelope in the body (`useBenzeneMessage(...)`).
 */
export class QueueStorageMessageTopicGetter implements IMessageTopicGetter<QueueStorageContext> {
  getTopic(_context: QueueStorageContext): ITopic | undefined {
    return undefined;
  }
}
