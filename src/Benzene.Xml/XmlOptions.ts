/** Port of Benzene.Xml.XmlOptions. */

/**
 * Configures the {@link XmlSerializer}'s deserialize path.
 * Port of Benzene.Xml.XmlOptions.
 *
 * **`maxDepth` → `maxNestedTags` mapping.** The C# original enforces `MaxDepth` with its own
 * `DepthGuardedXmlReader` decorator because the BCL `XmlReader` has no built-in nesting bound. The
 * `fast-xml-parser` library this port adapts DOES bound nesting itself (its `maxNestedTags` option,
 * library default 100, throwing `"Maximum nested tags exceeded"`), so the port pins the library's own
 * guard to this option instead of re-implementing a depth counter. The library's counter is off by one
 * relative to element depth (its tag stack includes the enclosing document node — verified against
 * fast-xml-parser 5.10.1: with `maxNestedTags: N` a payload nested `N + 1` elements deep parses and
 * `N + 2` rejects), so {@link XmlSerializer} passes `maxNestedTags: maxDepth - 1`, making `maxDepth`
 * the deepest element nesting accepted — the same observable contract as .NET's `XmlOptions.MaxDepth`.
 *
 * Serialization is not guarded (not attacker-controlled; out of scope), matching .NET.
 */
export class XmlOptions {
  /** The default for {@link maxDepth} when not overridden. Port of C# `XmlOptions.DefaultMaxDepth`. */
  static readonly defaultMaxDepth = 32;

  /**
   * The maximum XML element-nesting depth `deserialize` will follow before rejecting the payload
   * (#260's guard, via fast-xml-parser's own `maxNestedTags` bound — see the class remarks). A
   * deeply-nested "billion tags" bomb from an untrusted, content-negotiated request body is rejected
   * at this cap instead of exhausting memory/CPU building an equally deep object graph.
   *
   * Defaults to {@link defaultMaxDepth} (32) - comfortably above any reasonable real request shape.
   * Increase it only for a legitimately deeply-nested payload.
   */
  maxDepth: number = XmlOptions.defaultMaxDepth;
}
