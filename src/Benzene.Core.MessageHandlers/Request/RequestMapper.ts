import { IPayloadSerializer, ISerializer } from '@benzene/abstractions';
import { IRequestMapper, isRequestContext } from '@benzene/abstractions-message-handlers';
import { IMessageBodyBytesGetter, IMessageBodyGetter } from '@benzene/abstractions-messages';

/**
 * Default single-serializer `IRequestMapper<TContext>` implementation: deserializes the message body
 * via the given `ISerializer`, or reads it directly from `IRequestContext<TRequest>` if the context
 * already carries a pre-mapped request.
 * Port of Benzene.Core.MessageHandlers.Request.RequestMapper&lt;TContext&gt;.
 *
 * Deviations:
 * - The C# `context is IRequestContext<TRequest>` type-check becomes the duck-typing
 *   `isRequestContext` guard (interfaces are erased).
 * - The C# `serializer as IPayloadSerializer` cast becomes the `isPayloadSerializer` duck-typing
 *   check (has a `deserializeFromBytes` method).
 * - Empty/missing body: C# calls `Activator.CreateInstance<TRequest>()` to default-construct the
 *   erased generic. There is no TypeScript equivalent for constructing an erased generic, so the
 *   port returns `{} as TRequest` — the closest analogue to C#'s default-construction for the plain
 *   settable DTOs enrichment targets. This empty-body fallback is load-bearing, not a convenience:
 *   bodyless requests (e.g. HTTP GET) rely entirely on `EnrichingRequestMapper` to populate the
 *   instance afterwards, and returning `undefined` here would skip enrichment.
 */
export class RequestMapper<TContext> implements IRequestMapper<TContext> {
  private readonly payloadSerializer: IPayloadSerializer | undefined;

  constructor(
    private readonly messageBodyGetter: IMessageBodyGetter<TContext>,
    private readonly serializer: ISerializer,
    private readonly messageBodyBytesGetter?: IMessageBodyBytesGetter<TContext>,
  ) {
    this.payloadSerializer = isPayloadSerializer(serializer) ? serializer : undefined;
  }

  getBody<TRequest>(context: TContext): TRequest | undefined {
    if (isRequestContext<TRequest>(context)) {
      return context.request;
    }

    if (this.payloadSerializer !== undefined && this.messageBodyBytesGetter !== undefined) {
      const bodyAsBytes = this.messageBodyBytesGetter.getBodyBytes(context);

      return bodyAsBytes.length > 0
        ? this.payloadSerializer.deserializeFromBytes<TRequest>(bodyAsBytes)
        : ({} as TRequest);
    }

    const bodyAsString = this.messageBodyGetter.getBody(context);

    return bodyAsString !== undefined && bodyAsString !== ''
      ? this.serializer.deserialize<TRequest>(bodyAsString)
      : ({} as TRequest);
  }
}

/** Runtime port of the C# `serializer as IPayloadSerializer` capability check. */
function isPayloadSerializer(serializer: ISerializer): serializer is IPayloadSerializer {
  return (
    typeof (serializer as IPayloadSerializer).deserializeFromBytes === 'function' &&
    typeof (serializer as IPayloadSerializer).serializeToBytes === 'function'
  );
}
