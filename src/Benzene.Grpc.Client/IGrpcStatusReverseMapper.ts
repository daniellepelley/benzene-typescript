import { ServiceToken, serviceToken } from '@benzene/abstractions';
import { Metadata, status } from '@grpc/grpc-js';

/**
 * Port of Benzene.Grpc.Client.IGrpcStatusReverseMapper.
 *
 * Defines a contract for mapping a gRPC call outcome back to a Benzene result status. When `trailers`
 * carries a `benzene-status` entry (set by a Benzene-hosted server, see `@benzene/grpc`'s
 * `GrpcMessageHandlerResultSetter`/`GrpcMethodHandler`), that raw value wins verbatim — it preserves
 * distinctions (e.g. `created` vs `accepted`) that collapse to the same `status.OK` on the wire.
 *
 * BEND (`Grpc.Core.StatusCode` → `@grpc/grpc-js` `status`, `Grpc.Core.Metadata` → grpc-js `Metadata`):
 * grpc-js's `status` enum matches `Grpc.Core.StatusCode` name-for-name and value-for-value; grpc-js's
 * `Metadata` is the trailing-metadata type the client callback / `status` event surfaces.
 */
export interface IGrpcStatusReverseMapper {
  map(statusCode: status, trailers: Metadata | undefined): string;
}

export const IGrpcStatusReverseMapper: ServiceToken<IGrpcStatusReverseMapper> =
  serviceToken<IGrpcStatusReverseMapper>('IGrpcStatusReverseMapper');
