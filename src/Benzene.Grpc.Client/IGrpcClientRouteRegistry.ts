import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { GrpcClientMarshaller } from './GrpcClientRoute';
import { IGrpcClientRoute } from './IGrpcClientRoute';

/**
 * Port of Benzene.Grpc.Client.IGrpcClientRouteRegistry.
 *
 * The topic → gRPC-method routing table for the outbound client. Resolved from the container by
 * {@link GrpcBenzeneMessageClient}, so it declares a merged {@link ServiceToken}.
 */
export interface IGrpcClientRouteRegistry {
  /**
   * Registers a unary gRPC call under `topic`. `fullMethodName` is the gRPC method's fully-qualified
   * path, e.g. `/benzene.test.TestService/Echo`.
   *
   * BEND (`Add<TRequest,TResponse>(topic, fullMethodName)` → `add(topic, fullMethodName, marshaller?)`):
   * .NET's type parameters are the RPC's protobuf wire types, used to build the method's protobuf
   * marshallers from each type's static `Parser`. The port has no framework protobuf type (see
   * {@link GrpcClientRoute}), so the wire codec is supplied explicitly as an optional `marshaller`,
   * defaulting to a JSON codec. `TRequest`/`TResponse` stay as (erased) type parameters for call-site
   * documentation and marshaller typing.
   */
  add<TRequest = unknown, TResponse = unknown>(
    topic: string,
    fullMethodName: string,
    marshaller?: GrpcClientMarshaller<TRequest, TResponse>,
  ): IGrpcClientRouteRegistry;

  find(topic: string): IGrpcClientRoute | undefined;
}

export const IGrpcClientRouteRegistry: ServiceToken<IGrpcClientRouteRegistry> =
  serviceToken<IGrpcClientRouteRegistry>('IGrpcClientRouteRegistry');
