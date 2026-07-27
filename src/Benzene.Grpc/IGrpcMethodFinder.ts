import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';

/** Port of Benzene.Grpc.IGrpcMethodFinder. Discovers the gRPC method → topic bindings. */
export interface IGrpcMethodFinder {
  findDefinitions(): IGrpcMethodDefinition[];
}

export const IGrpcMethodFinder: ServiceToken<IGrpcMethodFinder> =
  serviceToken<IGrpcMethodFinder>('IGrpcMethodFinder');
