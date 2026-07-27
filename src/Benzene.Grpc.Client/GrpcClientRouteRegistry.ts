import { BenzeneException } from '@benzene/core';
import { GrpcClientMarshaller, GrpcClientRoute, jsonGrpcMarshaller } from './GrpcClientRoute';
import { IGrpcClientRoute } from './IGrpcClientRoute';
import { IGrpcClientRouteRegistry } from './IGrpcClientRouteRegistry';

/**
 * Port of Benzene.Grpc.Client.GrpcClientRouteRegistry.
 *
 * The default topic → route table. `add` validates the full method name has the `/package.Service/Method`
 * shape (throwing a {@link BenzeneException} otherwise, as .NET does), then registers a
 * {@link GrpcClientRoute} closed over the wire path and marshaller.
 *
 * PORT NOTE: .NET reflects and caches each protobuf type's static `Parser` to build the method's
 * marshallers. The port has no framework protobuf type, so there is no parser cache; the wire codec is the
 * supplied `marshaller` (defaulting to the JSON codec — see {@link GrpcClientRoute}).
 */
export class GrpcClientRouteRegistry implements IGrpcClientRouteRegistry {
  private readonly routesByTopic = new Map<string, IGrpcClientRoute>();

  add<TRequest = unknown, TResponse = unknown>(
    topic: string,
    fullMethodName: string,
    marshaller: GrpcClientMarshaller<TRequest, TResponse> = jsonGrpcMarshaller as GrpcClientMarshaller<
      TRequest,
      TResponse
    >,
  ): IGrpcClientRouteRegistry {
    const path = GrpcClientRouteRegistry.normalizeFullMethodName(fullMethodName);
    this.routesByTopic.set(topic, new GrpcClientRoute<TRequest, TResponse>(path, marshaller));
    return this;
  }

  find(topic: string): IGrpcClientRoute | undefined {
    return this.routesByTopic.get(topic);
  }

  /**
   * Validates and normalizes a full method name to grpc-js's `/package.Service/Method` path form.
   * Mirrors .NET's `SplitFullMethodName` validation (requires a `service/method` separator) while
   * returning the reconstructed full path grpc-js's `makeUnaryRequest` expects.
   */
  private static normalizeFullMethodName(fullMethodName: string): string {
    const trimmed = fullMethodName.replace(/^\/+/, '');
    const separatorIndex = trimmed.lastIndexOf('/');
    if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
      throw new BenzeneException(
        `'${fullMethodName}' is not a valid gRPC method name; expected '/package.Service/Method'.`,
      );
    }

    return `/${trimmed}`;
  }
}
