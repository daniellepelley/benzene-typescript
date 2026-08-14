import { IMessageHandlerResult } from '@benzenejs/abstractions-message-handlers';
import { MessageMessageHandlerResultSetterBase } from '@benzenejs/core-message-handlers';
import { GrpcContext } from './GrpcContext';

/**
 * Port of Benzene.Grpc.GrpcMessageHandlerResultSetter.
 *
 * Records the handler's outcome on the context. Extends the shared
 * {@link MessageMessageHandlerResultSetterBase} (which writes the pass/fail `messageResult` required by
 * `IHasMessageResult`) and additionally stores the full {@link IMessageHandlerResult} and the response
 * payload — both of which {@link GrpcMethodHandler} needs to map the Benzene status onto a grpc status
 * code + trailer and to produce the wire response. Mirrors the .NET setter, which likewise writes both
 * `MessageHandlerResult` and `ResponseAsObject`.
 */
export class GrpcMessageHandlerResultSetter extends MessageMessageHandlerResultSetterBase<GrpcContext> {
  override setResultAsync(
    context: GrpcContext,
    messageHandlerResult: IMessageHandlerResult,
  ): Promise<void> {
    context.messageHandlerResult = messageHandlerResult;
    context.responsePayload = messageHandlerResult.benzeneResult.payloadAsObject;
    return super.setResultAsync(context, messageHandlerResult);
  }
}
