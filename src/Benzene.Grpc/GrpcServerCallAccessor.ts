import { GrpcServerCall } from './GrpcContext';
import { IGrpcServerCallAccessor } from './IGrpcServerCallAccessor';

/**
 * Port of Benzene.Grpc.GrpcServerCallAccessor. Scoped holder populated by {@link GrpcMethodHandler} at
 * the start of each call — of any RPC shape — so handler code can resolve {@link IGrpcServerCallAccessor}
 * to read it.
 */
export class GrpcServerCallAccessor implements IGrpcServerCallAccessor {
  call: GrpcServerCall | undefined;

  get cancelled(): boolean {
    return this.call?.cancelled ?? false;
  }
}
