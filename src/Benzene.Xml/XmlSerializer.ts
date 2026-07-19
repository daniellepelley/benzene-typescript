/** Port of Benzene.Xml.XmlSerializer. */
import { Constructor, ISerializer } from '@benzene/abstractions';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

/**
 * XML {@link ISerializer} adapting the `fast-xml-parser` library.
 * Port of Benzene.Xml.XmlSerializer.
 *
 * **`fast-xml-parser` mapping.** The C# original wraps `System.Xml.Serialization.XmlSerializer`, which
 * is reflection-driven: it derives the root element name and the element structure from the runtime
 * `Type`. `fast-xml-parser` is shape-based — `XMLBuilder.build(obj)` turns a plain object into XML and
 * `XMLParser.parse(xml)` turns XML back into a plain object — so the C# per-`Type` serializer cache and
 * reflection plumbing are subsumed and not ported.
 *
 * **Erasure handling (root element name).** .NET names the root element after `typeof(T).Name`. That
 * type is erased in TypeScript, so on the serialize path the root name is taken from the payload's
 * runtime `constructor.name` (a plain object literal therefore roots as `Object`; pass a class instance,
 * like every other Benzene message type, to get a meaningful name). An explicit `rootName` argument
 * overrides it. On the deserialize path the single root element is unwrapped and its contents returned;
 * the erased `T` is not needed to pick a serializer (unlike the C# `typeof(T)`), and — as with every
 * Benzene serializer — the result is a plain object with the message's property shape, not an instance
 * of the message class.
 *
 * **Value typing.** The parser is configured with `parseTagValue: false` / `parseAttributeValue: false`
 * so element text stays a `string` and round-trips faithfully (there is no declared type to coerce back
 * to, so leaving values as their on-the-wire string form is the predictable choice; a typed C# consumer
 * would coerce to the property type, which erasure removes here).
 */
export class XmlSerializer implements ISerializer {
  private static readonly builder = new XMLBuilder({ ignoreAttributes: true, suppressEmptyNode: true });

  private static readonly parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    parseAttributeValue: false,
    ignoreDeclaration: true,
  });

  /**
   * Port of C# `string Serialize<T>(T payload)` — XML text with the root element named after the
   * payload's `constructor.name` (or `rootName` if given). Empty string for null/undefined.
   */
  serialize<T>(payload: T, rootName?: string): string {
    if (payload === undefined || payload === null) {
      return '';
    }
    const root = rootName ?? (payload as object).constructor.name;
    return XmlSerializer.builder.build({ [root]: payload });
  }

  /**
   * Port of C# `T? Deserialize<T>(string payload)` — parses the XML and unwraps the single root
   * element to its contents. `undefined` for an empty payload. `targetType` is accepted for parity with
   * the schema-based serializers but is not required (the root element is unwrapped structurally).
   */
  deserialize<T>(payload: string, _targetType?: Constructor<T>): T | undefined {
    if (payload === undefined || payload === null || payload === '') {
      return undefined;
    }
    const parsed = XmlSerializer.parser.parse(payload) as Record<string, unknown>;
    const rootKeys = Object.keys(parsed);
    if (rootKeys.length === 0) {
      return undefined;
    }
    // Unwrap the single root element (mirroring the wrapping done on serialize).
    return parsed[rootKeys[0] as string] as T;
  }
}
