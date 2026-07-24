/** Port of Benzene.Abstractions.Messages.MessageVersionHeaders. */

/**
 * Well-known names for the header/attribute that carries a message's payload schema version on the wire.
 *
 * The inbound reader (`HeaderMessageVersionGetter`) tries a fallback list; `default` is its primary name
 * and the one the outbound helpers write, so a producer and consumer agree on the version signal without
 * hard-coding the literal in two places. HTTP additionally carries the version as a `/v{version}` route
 * segment; this header is the convention for every other transport (and the HTTP fallback).
 *
 * C# `public static class` of a `const string` -> a frozen object; the string VALUE is the wire name.
 */
export const MessageVersionHeaders = {
  /** The canonical version header/attribute name: `benzene-version`. */
  default: 'benzene-version',
} as const;
