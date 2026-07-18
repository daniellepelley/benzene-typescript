/** Port of Benzene.Aws.Lambda.Sns.SnsUtils. */
import { SnsRecordContext } from './SnsRecordContext';

/**
 * Helper for reading SNS message attributes.
 *
 * PascalCase mapping: C# `context.SnsRecord.Sns?.MessageAttributes?.ContainsKey(key)` /
 * `MessageAttributes[key].Value` become `context.snsRecord.Sns?.MessageAttributes?.[key]?.Value`. An SNS
 * message attribute in `@types/aws-lambda` is `{ Type, Value }`, so the string value is read from `.Value`
 * (there is no separate typed `stringValue` as on SQS).
 */
export const SnsUtils = {
  /**
   * Gets a message attribute value from an SNS record by key, or `undefined` if the attribute (or the
   * `Sns`/`MessageAttributes` object) is absent. C# `null` maps to `undefined`.
   */
  getFromAttributes(context: SnsRecordContext, key: string): string | undefined {
    return context.snsRecord.Sns?.MessageAttributes?.[key]?.Value;
  },
};
