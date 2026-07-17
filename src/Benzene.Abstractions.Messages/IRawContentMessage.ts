import { IRawStringMessage } from './IRawStringMessage';

/**
 * A raw payload that also carries its own content type, so a response renderer can set the
 * transport's content type from the payload itself instead of the negotiated format.
 * Port of Benzene.Abstractions.Messages.IRawContentMessage.
 *
 * Deviation: like `IRawStringMessage`, detection uses the exported `isRawContentMessage` duck-typing
 * guard (string `content` + string `contentType`) rather than the erased C# `is` check. Payload
 * marker only, so no `ServiceToken`.
 */
export interface IRawContentMessage extends IRawStringMessage {
  /** The content type this payload should be delivered with. */
  readonly contentType: string;
}

/** Runtime port of C# `payload is IRawContentMessage`. */
export function isRawContentMessage(payload: unknown): payload is IRawContentMessage {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { content?: unknown }).content === 'string' &&
    typeof (payload as { contentType?: unknown }).contentType === 'string'
  );
}
