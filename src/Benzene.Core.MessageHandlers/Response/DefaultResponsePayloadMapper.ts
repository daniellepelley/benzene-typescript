import { ISerializer } from '@benzenejs/abstractions';
import { IMessageHandlerResult, IResponsePayloadMapper } from '@benzenejs/abstractions-message-handlers';
import { isRawStringMessage } from '@benzenejs/abstractions-messages';
import { ProblemTypes } from '@benzenejs/results';

/**
 * Default `IResponsePayloadMapper<TContext>` implementation: serializes the handler's success
 * payload, or — on failure — an RFC 9457 problem document synthesized from the result's status and
 * errors by `ProblemTypes.from` (wire-contracts.md §1.3). This replaced the pre-RFC-9457
 * `ErrorPayload` body; `detail` is the compatibility member, carrying the same joined error string
 * that shape's only populated member did.
 * Port of Benzene.Core.MessageHandlers.Response.DefaultResponsePayloadMapper&lt;TContext&gt;.
 *
 * Deviations: C# returns `null` when no handler was resolved or the success payload is null; the port
 * returns `undefined`. C# `serializer.Serialize(type, payload)` (payload's declared response type) is
 * shape-based in TypeScript, so the erased response type is dropped and `serializer.serialize(payload)`
 * is used. A raw-string payload is detected with the `isRawStringMessage` duck-typing guard rather
 * than the erased C# `is IRawStringMessage` check.
 */
export class DefaultResponsePayloadMapper<TContext> implements IResponsePayloadMapper<TContext> {
  map(
    _context: TContext,
    messageHandlerResult: IMessageHandlerResult,
    serializer: ISerializer,
  ): string | undefined {
    if (messageHandlerResult.messageHandlerDefinition === undefined) {
      return undefined;
    }

    return messageHandlerResult.benzeneResult.isSuccessful
      ? this.serializePayload(messageHandlerResult.benzeneResult.payloadAsObject, serializer)
      : serializer.serialize(ProblemTypes.from(messageHandlerResult.benzeneResult));
  }

  private serializePayload(payload: unknown, serializer: ISerializer): string | undefined {
    if (payload === undefined || payload === null) {
      return undefined;
    }

    if (isRawStringMessage(payload)) {
      return payload.content;
    }

    return serializer.serialize(payload);
  }
}
