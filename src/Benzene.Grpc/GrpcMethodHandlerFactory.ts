import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { GrpcContext } from './GrpcContext';
import { GrpcMethodHandler } from './GrpcMethodHandler';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { IGrpcMethodHandler } from './IGrpcMethodHandler';
import { IGrpcMethodHandlerFactory } from './IGrpcMethodHandlerFactory';

/**
 * Port of Benzene.Grpc.GrpcMethodHandlerFactory. Creates a {@link GrpcMethodHandler} bound to the given
 * method definition, giving it a fresh service-resolver factory (so each call runs in its own scope) over
 * the one shared pipeline.
 */
export class GrpcMethodHandlerFactory implements IGrpcMethodHandlerFactory {
  private readonly services: IBenzeneServiceContainer;
  private readonly middlewarePipeline: IMiddlewarePipeline<GrpcContext>;

  constructor(
    services: IBenzeneServiceContainer,
    middlewarePipeline: IMiddlewarePipeline<GrpcContext>,
  ) {
    this.services = services;
    this.middlewarePipeline = middlewarePipeline;
  }

  create(grpcMethodDefinition: IGrpcMethodDefinition): IGrpcMethodHandler {
    return new GrpcMethodHandler(
      grpcMethodDefinition,
      this.services.createServiceResolverFactory(),
      this.middlewarePipeline,
    );
  }
}
