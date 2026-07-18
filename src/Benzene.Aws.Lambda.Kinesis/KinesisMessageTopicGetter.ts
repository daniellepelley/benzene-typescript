/** Port of Benzene.Aws.Lambda.Kinesis (topic getter — see KinesisMessageContext's ADAPTATION note). */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { KinesisMessageContext } from './KinesisMessageContext';

/**
 * A Kinesis record carries no routing topic of its own (the payload is opaque bytes and the record
 * metadata is transport plumbing, not a message type). So this getter returns a topic with a MISSING id
 * (C# `Constants.Missing`) and relies on the PRESET TOPIC mechanism: `addKinesis` wraps it in
 * `PresetTopicMessageTopicGetter`, and a pipeline routes its records to a fixed topic via
 * `usePresetTopic('<topic>')` before `useMessageHandlers`. This is the same preset-topic escape hatch the
 * SQS adapter offers for raw (non-Benzene) producers — the natural fit for a source with no per-message
 * topic.
 */
export class KinesisMessageTopicGetter implements IMessageTopicGetter<KinesisMessageContext> {
  getTopic(_context: KinesisMessageContext): ITopic | undefined {
    return new Topic(undefined);
  }
}
