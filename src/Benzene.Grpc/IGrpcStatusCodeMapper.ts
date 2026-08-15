import { ServiceToken, serviceToken } from '@benzenejs/abstractions';
import { status } from '@grpc/grpc-js';

/**
 * Port of Benzene.Grpc.IGrpcStatusCodeMapper.
 *
 * Maps a Benzene result status string to a grpc-js {@link status} code (the `@grpc/grpc-js` equivalent
 * of .NET's `Grpc.Core.StatusCode`; same numeric values and names).
 */
export interface IGrpcStatusCodeMapper {
  /**
   * Deviation: C# declares `Map(string)` plus a `Map(string, bool)` overload; TypeScript has no
   * overload defaulting, so the pair collapses into one method with an **optional** `isSuccessful`.
   * It is consulted only for a status outside the known vocabulary — an application-defined
   * *successful* status maps to {@link status.OK} rather than {@link status.INTERNAL}, since the
   * caller's `isSuccessful` is the authoritative signal for a custom status. The raw status string
   * still reaches the client verbatim via the `benzene-status` trailer regardless.
   */
  map(benzeneResultStatus: string | undefined, isSuccessful?: boolean): status;
}

export const IGrpcStatusCodeMapper: ServiceToken<IGrpcStatusCodeMapper> =
  serviceToken<IGrpcStatusCodeMapper>('IGrpcStatusCodeMapper');
