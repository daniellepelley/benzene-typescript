import { ServiceToken, serviceToken } from '@benzenejs/abstractions';

/**
 * Port of Benzene.Grpc.Serialization.IGrpcMessageAdapter.
 *
 * Bridges Benzene message-handler payloads and gRPC wire messages. `convertRequest` turns an incoming
 * wire message into the handler's request type; `convertResponse` turns a handler's response payload into
 * the outgoing wire message. A handler that already declares the wire type gets pass-through either way.
 */
export interface IGrpcMessageAdapter {
  /**
   * Converts an incoming gRPC request message into the handler's request type. Returns the same instance
   * when it already is that type. Unconstrained `TRequest` (matching .NET) so it composes with the
   * unconstrained message-client `TResponse`.
   */
  convertRequest<TRequest>(message: unknown): TRequest | undefined;

  /**
   * Converts a handler's response payload into the outgoing gRPC response type. Returns the same instance
   * when the payload already is that type.
   */
  convertResponse<TResponse>(payload: unknown): TResponse;
}

export const IGrpcMessageAdapter: ServiceToken<IGrpcMessageAdapter> =
  serviceToken<IGrpcMessageAdapter>('IGrpcMessageAdapter');
