/** Port of Benzene.Abstractions.Messages.MessageVersionHeaders. */

/**
 * The one well-known name for the header/attribute that carries a message's version on the wire
 * (wire-contracts §2, tier A): it selects the handler (core-concepts §2) and names the payload's schema
 * version for casting (versioning.md).
 *
 * The inbound reader (`HeaderMessageVersionGetter`) reads exactly this name (or the one the application
 * configured in its place) — there is no fallback list, so a `version`/`x-version` header is an ordinary
 * header. It is also the name the outbound helpers write, so a producer and consumer agree without
 * hard-coding the literal twice. HTTP may carry the version as a `/v{version}` route segment instead.
 *
 * C# `public static class` of a `const string` -> a frozen object; the string VALUE is the wire name.
 */
export const MessageVersionHeaders = {
  /** The canonical version header/attribute name: `benzene-version`. */
  default: 'benzene-version',
} as const;
