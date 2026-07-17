import { ISerializer, ServiceToken, serviceToken } from '@benzene/abstractions';
import { IMessageHandlerResult } from '../IMessageHandlerResult';

/**
 * Converts a message handler's result into a serialized response body using the given serializer,
 * so the serialized payload format stays independent of how the body is written onto the transport.
 * Port of Benzene.Abstractions.MessageHandlers.Response.IResponsePayloadMapper&lt;TContext&gt;.
 */
export interface IResponsePayloadMapper<TContext> {
  /**
   * Maps a handler's result into a serialized response body. Port of C# `Map`; C# can return `null`,
   * which maps to `undefined`.
   */
  map(
    context: TContext,
    messageHandlerResult: IMessageHandlerResult,
    serializer: ISerializer,
  ): string | undefined;
}

export const IResponsePayloadMapper: ServiceToken<IResponsePayloadMapper<unknown>> =
  serviceToken<IResponsePayloadMapper<unknown>>('IResponsePayloadMapper');
