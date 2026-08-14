import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { IGrpcMethodHandler } from './IGrpcMethodHandler';

/** Port of Benzene.Grpc.IGrpcMethodHandlerFactory. Creates a per-call handler for a method definition. */
export interface IGrpcMethodHandlerFactory {
  create(grpcMethodDefinition: IGrpcMethodDefinition): IGrpcMethodHandler;
}

export const IGrpcMethodHandlerFactory: ServiceToken<IGrpcMethodHandlerFactory> =
  serviceToken<IGrpcMethodHandlerFactory>('IGrpcMethodHandlerFactory');
