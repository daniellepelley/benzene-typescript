/** Port of Benzene.Aws.Lambda.Sns.SnsMessageTopicGetter. */
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { SnsRecordContext } from './SnsRecordContext';
import { SnsUtils } from './SnsUtils';

/**
 * Extracts the message topic from an SNS record's `topic` message attribute (the same convention as SQS:
 * a Benzene publisher sets a `topic` message attribute, and the handler declares `@message('<topic>')`).
 * PascalCase mapping: C# `SnsUtils.GetFromAttributes(context, "topic")` reads
 * `MessageAttributes["topic"].Value`. A missing attribute yields `undefined`, which `Topic` maps to the
 * `<missing>` id (C# `Constants.Missing`).
 */
export class SnsMessageTopicGetter implements IMessageTopicGetter<SnsRecordContext> {
  /**
   * The default message-attribute key the topic is read from (`topic`) — the spec's reserved topic
   * name (wire-contracts.md §2). Port of the C# `SnsMessageTopicGetter.DefaultTopicAttribute` constant,
   * which aliases `BenzeneWireNames.DefaultTopic`; the TS port has no `BenzeneWireNames` type yet, so the
   * literal lives here (see README "Porting conventions").
   */
  static readonly DefaultTopicAttribute = 'topic';

  getTopic(context: SnsRecordContext): ITopic | undefined {
    return new Topic(SnsUtils.getFromAttributes(context, SnsMessageTopicGetter.DefaultTopicAttribute));
  }
}
