/** Port of Benzene.Core.Messages.RawStringMessage. */
import { IRawStringMessage } from '@benzenejs/abstractions-messages';

/**
 * A payload carrying its own pre-serialized string content, delivered as-is by the response renderer
 * instead of being run through the negotiated serializer. Concrete implementation of `IRawStringMessage`
 * (detected at runtime by the `isRawStringMessage` duck-typing guard - it has a string `content`).
 */
export class RawStringMessage implements IRawStringMessage {
  constructor(readonly content: string) {}
}
