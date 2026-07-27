import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { status } from '@grpc/grpc-js';

/**
 * Port of Benzene.Grpc.IGrpcStatusCodeMapper.
 *
 * Maps a Benzene result status string to a grpc-js {@link status} code (the `@grpc/grpc-js` equivalent
 * of .NET's `Grpc.Core.StatusCode`; same numeric values and names).
 */
export interface IGrpcStatusCodeMapper {
  map(benzeneResultStatus: string | undefined): status;
}

export const IGrpcStatusCodeMapper: ServiceToken<IGrpcStatusCodeMapper> =
  serviceToken<IGrpcStatusCodeMapper>('IGrpcStatusCodeMapper');
