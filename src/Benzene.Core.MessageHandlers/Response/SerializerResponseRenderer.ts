import { IServiceResolver } from '@benzenejs/abstractions';
import {
  IBenzeneResponseAdapter,
  IMediaFormat,
  IMediaFormatNegotiator,
  IMessageHandlerResult,
  IResponsePayloadMapper,
  IResponseRenderer,
} from '@benzenejs/abstractions-message-handlers';
import { isRawContentMessage } from '@benzenejs/abstractions-messages';

/**
 * Renders the handler's result in whichever `IMediaFormat<TContext>` the negotiator selects for the
 * current message (JSON by default; XML or any other registered format when negotiated). The
 * catch-all `IResponseRenderer<TContext>` every transport registers last, wrapped by
 * `RendererResponseHandler<TContext>`.
 * Port of Benzene.Core.MessageHandlers.Response.SerializerResponseRenderer&lt;TContext&gt;.
 *
 * Deviations: the payload mapper may return `undefined` (the port of C# `null`); it is handed to
 * `setBody` as-is, mirroring C# passing the mapper result straight through. A raw-content payload is
 * detected with the `isRawContentMessage` duck-typing guard rather than the erased C# `is` check.
 */
export class SerializerResponseRenderer<TContext> implements IResponseRenderer<TContext> {
  constructor(
    private readonly responsePayloadMapper: IResponsePayloadMapper<TContext>,
    private readonly mediaFormatNegotiator: IMediaFormatNegotiator<TContext>,
    private readonly serviceResolver: IServiceResolver,
  ) {}

  /** The catch-all: always applies, so this must be registered last. */
  canRender(_context: TContext, _result: IMessageHandlerResult, _resolver: IServiceResolver): boolean {
    return true;
  }

  renderAsync(
    context: TContext,
    result: IMessageHandlerResult,
    response: IBenzeneResponseAdapter<TContext>,
  ): Promise<void> {
    const format = this.mediaFormatNegotiator.selectWrite(context);
    const serializer = format.getSerializer(this.serviceResolver);

    const body = this.responsePayloadMapper.map(context, result, serializer);
    response.setBody(context, body as string);

    response.setContentType(context, this.resolveContentType(result, format));

    return Promise.resolve();
  }

  /**
   * The response content type: a raw content payload's own type verbatim; otherwise, on a failed
   * result, the negotiated format's media type rewritten to its RFC 9457 "problem" counterpart
   * (`application/json` -> `application/problem+json`, `application/xml` ->
   * `application/problem+xml`, per RFC 9457 §11.2; any other negotiated format is left as-is — the
   * framework only defines a problem media type for the two it ships signalling for); otherwise the
   * negotiated format's ordinary media type.
   */
  private resolveContentType(result: IMessageHandlerResult, format: IMediaFormat<TContext>): string {
    const payload = result.benzeneResult.payloadAsObject;
    if (isRawContentMessage(payload)) {
      return payload.contentType;
    }

    return result.benzeneResult.isSuccessful
      ? format.contentType
      : problemContentType(format.contentType);
  }
}

function problemContentType(contentType: string): string {
  switch (contentType) {
    case 'application/json':
      return 'application/problem+json';
    case 'application/xml':
      return 'application/problem+xml';
    default:
      return contentType;
  }
}
