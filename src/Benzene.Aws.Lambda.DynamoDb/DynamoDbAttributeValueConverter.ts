/** Port of Benzene.Aws.Lambda.DynamoDb.DynamoDbAttributeValueConverter. */
import { AttributeValue } from 'aws-lambda';

/**
 * Unmarshals DynamoDB AttributeValue JSON (`{"Id": {"N": "101"}, "Message": {"S": "hi"}}`) into plain
 * JSON (`{"Id": 101, "Message": "hi"}`), so message handlers deserialize ordinary objects instead of the
 * stream's type-descriptor format (plan decision DS3).
 *
 * TYPE-MODEL ADAPTATION: the C# original enumerates raw `System.Text.Json.JsonElement`s. This port
 * operates on `@types/aws-lambda`'s already-parsed `AttributeValue` (an exclusive union of the descriptor
 * keys S/N/BOOL/NULL/M/L/SS/NS/B/BS), producing plain JavaScript values and serializing with
 * `JSON.stringify` — the same descriptor semantics as C#. Unknown descriptors pass their value through
 * raw rather than throwing, so a new DynamoDB type doesn't break existing consumers.
 */
export const DynamoDbAttributeValueConverter = {
  /**
   * Converts an AttributeValue map (an item image or key set) to a plain JSON string.
   */
  toJson(attributeMap: Record<string, AttributeValue>): string {
    return JSON.stringify(DynamoDbAttributeValueConverter.toObject(attributeMap));
  },

  /**
   * Converts an AttributeValue map (an item image or key set) to a plain JavaScript object.
   */
  toObject(attributeMap: Record<string, AttributeValue>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(attributeMap)) {
      result[name] = convertValue(value);
    }
    return result;
  },
};

function convertValue(attributeValue: AttributeValue): unknown {
  // An AttributeValue is an exclusive union carrying exactly one descriptor key.
  const entries = Object.entries(attributeValue as Record<string, unknown>);
  for (const [descriptor, raw] of entries) {
    switch (descriptor) {
      case 'S':
      case 'B':
        return raw as string;
      case 'N':
        // DynamoDB numbers are strings on the wire but are valid JSON number literals.
        return Number(raw as string);
      case 'BOOL':
        return raw as boolean;
      case 'NULL':
        return null;
      case 'M':
        return DynamoDbAttributeValueConverter.toObject(raw as Record<string, AttributeValue>);
      case 'L':
        return (raw as AttributeValue[]).map(convertValue);
      case 'SS':
      case 'BS':
        return raw as string[];
      case 'NS':
        return (raw as string[]).map((item) => Number(item));
      default:
        // Unknown descriptor — pass the raw value through rather than throwing.
        return raw;
    }
  }

  return null;
}
