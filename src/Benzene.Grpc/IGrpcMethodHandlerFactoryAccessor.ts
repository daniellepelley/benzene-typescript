import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IGrpcMethodHandlerFactory } from './IGrpcMethodHandlerFactory';

/**
 * Port of Benzene.Grpc.IGrpcMethodHandlerFactoryAccessor.
 *
 * Holds the {@link IGrpcMethodHandlerFactory} configured by `useGrpc`. In .NET this seam exists because
 * ASP.NET Core activates the gRPC interceptor per request in a DI container separate from the pipeline-
 * building one; the accessor is the single instance both see. The port has no interceptor/ASP.NET split
 * (the grpc-js `Server` is the host — see the README), but the accessor is kept for parity and so the host
 * bridge resolves the factory the same way.
 */
export interface IGrpcMethodHandlerFactoryAccessor {
  /** The configured factory, or `undefined` if `useGrpc` has not run yet. */
  factory: IGrpcMethodHandlerFactory | undefined;
}

export const IGrpcMethodHandlerFactoryAccessor: ServiceToken<IGrpcMethodHandlerFactoryAccessor> =
  serviceToken<IGrpcMethodHandlerFactoryAccessor>('IGrpcMethodHandlerFactoryAccessor');
