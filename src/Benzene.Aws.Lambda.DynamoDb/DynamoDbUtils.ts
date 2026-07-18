/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbUtils. */

/**
 * Utility functions for working with DynamoDB stream records.
 */
export const DynamoDbUtils = {
  /**
   * Parses the table name out of a stream ARN
   * (`arn:aws:dynamodb:region:account:table/Name/stream/2015-06-27T00:48:05.899`), or `undefined` if the
   * ARN is missing or not in the expected shape (C# `null` maps to `undefined`).
   *
   * The resource segment contains colons of its own (the stream timestamp), so the ARN is split on `:`
   * with a maximum count of 6 before splitting the resource on `/`. TypeScript's `String.split(sep,
   * limit)` DISCARDS the remainder rather than keeping it in the last element (unlike C#'s
   * `Split(':', 6)`), so this reproduces the "max 6" semantics manually.
   */
  getTableName(eventSourceArn: string | undefined): string | undefined {
    if (eventSourceArn === undefined || eventSourceArn === '') {
      return undefined;
    }

    const arnParts = splitWithLimit(eventSourceArn, ':', 6);
    if (arnParts.length < 6) {
      return undefined;
    }

    const resourceParts = arnParts[5].split('/');
    if (resourceParts.length < 2 || resourceParts[0] !== 'table') {
      return undefined;
    }

    return resourceParts[1];
  },
};

/**
 * Splits `value` on `separator` into at most `limit` parts, keeping everything after the (limit-1)th
 * separator intact in the final part — matching .NET's `string.Split(char, int)`, which differs from
 * JavaScript's `String.split(sep, limit)` (the latter drops the remainder).
 */
function splitWithLimit(value: string, separator: string, limit: number): string[] {
  const parts: string[] = [];
  let remaining = value;
  while (parts.length < limit - 1) {
    const index = remaining.indexOf(separator);
    if (index === -1) {
      break;
    }
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index + separator.length);
  }
  parts.push(remaining);
  return parts;
}
