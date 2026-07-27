import { IGrpcMethodHandlerFactory } from './IGrpcMethodHandlerFactory';
import { IGrpcMethodHandlerFactoryAccessor } from './IGrpcMethodHandlerFactoryAccessor';

/** Port of Benzene.Grpc.GrpcMethodHandlerFactoryAccessor. */
export class GrpcMethodHandlerFactoryAccessor implements IGrpcMethodHandlerFactoryAccessor {
  factory: IGrpcMethodHandlerFactory | undefined;
}
