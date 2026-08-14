import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';

/** Port of Benzene.Grpc.IGrpcRouteFinder. Case-insensitive gRPC method-path → definition lookup. */
export interface IGrpcRouteFinder {
  find(method: string): IGrpcMethodDefinition | undefined;
}

export const IGrpcRouteFinder: ServiceToken<IGrpcRouteFinder> =
  serviceToken<IGrpcRouteFinder>('IGrpcRouteFinder');
