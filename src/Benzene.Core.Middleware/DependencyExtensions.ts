import {
  IBenzeneServiceContainer,
  IRegisterDependency,
  tryAddSingletonFactory,
} from '@benzene/abstractions';
import {
  IMiddlewareFactory,
  IMiddlewarePipeline,
  IMiddlewareWrapper,
  PipelineBuilderAction,
} from '@benzene/abstractions-middleware';
import { DefaultMiddlewareFactory } from './DefaultMiddlewareFactory';
import { MiddlewarePipelineBuilder } from './MiddlewarePipelineBuilder';

/**
 * Port of Benzene.Core.Middleware.DependencyExtensions (C# extension methods
 * become free functions).
 */

/** Registers the middleware infrastructure services. Port of C# `AddBenzeneMiddleware`. */
export function addBenzeneMiddleware(services: IBenzeneServiceContainer): IBenzeneServiceContainer {
  tryAddSingletonFactory(
    services,
    IMiddlewareFactory,
    (resolver) => new DefaultMiddlewareFactory(resolver.getServices(IMiddlewareWrapper)),
  );
  services.addServiceResolver();
  return services;
}

/** Builds a standalone pipeline sharing the source's dependency registration. Port of C# `CreateMiddlewarePipeline`. */
export function createMiddlewarePipeline<TContext>(
  source: IRegisterDependency,
  action: PipelineBuilderAction<TContext>,
): IMiddlewarePipeline<TContext> {
  const middlewareBuilder = new MiddlewarePipelineBuilder<TContext>(source);
  action(middlewareBuilder);
  return middlewareBuilder.build();
}
