/** Port of Benzene.Aws.Lambda.Sns.SnsMessageHeadersGetter. */
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Exposes an SNS record's message attributes as headers. PascalCase mapping: C#
 * `SnsRecord.Sns.MessageAttributes.ToDictionary(x => x.Key, x => x.Value.Value)` becomes a walk of
 * `snsRecord.Sns.MessageAttributes` entries, each value's string taken from `.Value`. Unlike the SQS
 * getter there is no `dataType`/`Type` filter — every attribute is surfaced, exactly as the .NET original.
 */
export class SnsMessageHeadersGetter implements IMessageHeadersGetter<SnsRecordContext> {
  getHeaders(context: SnsRecordContext): Record<string, string> {
    const headers: Record<string, string> = {};
    const attributes = context.snsRecord.Sns?.MessageAttributes;
    if (attributes !== undefined) {
      for (const [key, attribute] of Object.entries(attributes)) {
        headers[key] = attribute.Value;
      }
    }
    return headers;
  }
}
