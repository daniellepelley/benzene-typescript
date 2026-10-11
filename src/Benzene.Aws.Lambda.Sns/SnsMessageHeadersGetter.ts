/** Port of Benzene.Aws.Lambda.Sns.SnsMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { withoutMetadataKey } from '@benzenejs/core-messages';
import { SnsMessageTopicGetter } from './SnsMessageTopicGetter';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Exposes an SNS record's message attributes as headers. PascalCase mapping: C#
 * `SnsRecord.Sns.MessageAttributes.ToDictionary(x => x.Key, x => x.Value.Value)` becomes a walk of
 * `snsRecord.Sns.MessageAttributes` entries, each value's string taken from `.Value`. Unlike the SQS
 * getter there is no `dataType`/`Type` filter — every attribute is surfaced, exactly as the .NET original. The configured topic key is consumed: it is the topic,
 * not a header (transport-metadata-cases.json `headersExclude`), so it is left out here, matched
 * case-insensitively like the topic getter reads it.
 */
export class SnsMessageHeadersGetter implements IMessageHeadersGetter<SnsRecordContext> {
  constructor(private readonly topicAttributeKey: string = SnsMessageTopicGetter.DefaultTopicAttribute) {}

  getHeaders(context: SnsRecordContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const attributes = context.snsRecord.Sns?.MessageAttributes;
    if (attributes !== undefined) {
      for (const [key, attribute] of Object.entries(attributes)) {
        headers[key] = attribute.Value;
      }
    }
    return withoutMetadataKey(headers, this.topicAttributeKey);
  }
}
