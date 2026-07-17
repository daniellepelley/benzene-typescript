/**
 * A payload that carries its own pre-serialized string content, delivered as-is by the response
 * renderer instead of being run through the negotiated serializer.
 * Port of Benzene.Abstractions.Messages.IRawStringMessage.
 *
 * Deviation: C# detects this with a runtime `is IRawStringMessage` type-check. TypeScript interfaces
 * are erased, so detection is done by the exported `isRawStringMessage` duck-typing guard (has a
 * string `content` member) rather than an `instanceof`. This interface is a payload marker, never
 * resolved from the container, so it declares no `ServiceToken`.
 */
export interface IRawStringMessage {
  readonly content: string;
}

/** Runtime port of C# `payload is IRawStringMessage`. */
export function isRawStringMessage(payload: unknown): payload is IRawStringMessage {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { content?: unknown }).content === 'string'
  );
}
