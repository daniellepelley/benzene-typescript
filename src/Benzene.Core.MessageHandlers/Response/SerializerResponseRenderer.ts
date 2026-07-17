import { IServiceResolver } from '@benzene/abstractions';
import {
  IBenzeneResponseAdapter,
  IMediaFormatNegotiator,
  IMessageHandlerResult,
  IResponsePayloadMapper,
  IResponseRenderer,
} from '@benzene/abstractions-message-handlers';
import { isRawContentMessage } from '@benzene/abstractions-messages';

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

    const payload = result.benzeneResult.payloadAsObject;
    response.setContentType(
      context,
      isRawContentMessage(payload) ? payload.contentType : format.contentType,
    );

    return Promise.resolve();
  }
}
