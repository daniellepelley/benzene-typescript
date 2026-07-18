/** Port of Benzene.Aws.Lambda.Sns.SnsMessageBodyGetter. */
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Extracts the raw message body from an SNS record. PascalCase mapping: C# `SnsRecord.Sns.Message`
 * becomes `snsRecord.Sns.Message`. SNS carries the published payload directly in `Sns.Message` (SNS's own
 * envelope is already unwrapped by the Lambda runtime), so this is the string a handler deserializes.
 */
export class SnsMessageBodyGetter implements IMessageBodyGetter<SnsRecordContext> {
  getBody(context: SnsRecordContext): string | undefined {
    return context.snsRecord.Sns.Message;
  }
}
