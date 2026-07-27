import { ServerUnaryCall } from '@grpc/grpc-js';
import { IGrpcServerCallAccessor } from './IGrpcServerCallAccessor';

/**
 * Port of Benzene.Grpc.GrpcServerCallAccessor. Scoped holder populated by {@link GrpcMethodHandler} at
 * the start of each call, so handler code can resolve {@link IGrpcServerCallAccessor} to read it.
 */
export class GrpcServerCallAccessor implements IGrpcServerCallAccessor {
  call: ServerUnaryCall<unknown, unknown> | undefined;

  get cancelled(): boolean {
    return this.call?.cancelled ?? false;
  }
}
