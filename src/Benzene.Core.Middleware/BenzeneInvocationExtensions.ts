import {
  IBenzeneServiceContainer,
  IServiceResolver,
  tryAddScoped,
  tryAddScopedFactory,
} from '@benzene/abstractions';
import {
  IBenzeneInvocation,
  IBenzeneInvocationAccessor,
  IMiddlewarePipelineBuilder,
} from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import { BenzeneInvocation, BenzeneInvocationAccessor } from './BenzeneInvocation';

/**
 * Port of Benzene.Core.Middleware.BenzeneInvocationExtensions (the platform-neutral registration and
 * middleware for `IBenzeneInvocation`). C# extension methods become free functions taking their target
 * as the first argument, per the port's extension-method convention.
 */

/**
 * Registers the services required to resolve `IBenzeneInvocation`. Called automatically by
 * `useBenzeneInvocation`; you don't normally need to call this directly.
 *
 * Mirrors the C# `AddBenzeneInvocation`: the accessor is a scoped holder, and `IBenzeneInvocation`
 * resolves from a scoped factory that reads the accessor and throws a `BenzeneException` when the
 * invocation was requested before the pipeline's `useBenzeneInvocation()` middleware populated it for
 * this invocation.
 *
 * @param services The service container to register services with.
 * @returns The service container, for chaining.
 */
export function addBenzeneInvocation(
  services: IBenzeneServiceContainer,
): IBenzeneServiceContainer {
  tryAddScoped(services, IBenzeneInvocationAccessor, BenzeneInvocationAccessor);
  tryAddScopedFactory(services, IBenzeneInvocation, (x: IServiceResolver) => {
    const invocation = x.getService(IBenzeneInvocationAccessor).invocation;
    if (invocation === undefined) {
      throw new BenzeneException(
        "IBenzeneInvocation was requested before the pipeline's useBenzeneInvocation() middleware populated it for this invocation.",
      );
    }
    return invocation;
  });
  return services;
}

/**
 * Adds middleware that builds and exposes an `IBenzeneInvocation` for the duration of the request, so
 * it can be injected wherever needed.
 *
 * Mirrors the C# `UseBenzeneInvocation<TContext>(builder, factory)`: it registers the invocation
 * services and then adds a "BenzeneInvocation" middleware that populates the accessor from `factory`
 * before continuing the pipeline. Hosting platforms expose their own zero-`factory` overload that
 * supplies this factory (e.g. `@benzene/aws-lambda-core`'s `useBenzeneInvocation`).
 *
 * @param app The pipeline builder to add the invocation middleware to.
 * @param factory Builds the invocation for a given resolver + context.
 * @returns The pipeline builder, for chaining.
 */
export function useBenzeneInvocation<TContext>(
  app: IMiddlewarePipelineBuilder<TContext>,
  factory: (serviceResolver: IServiceResolver, context: TContext) => IBenzeneInvocation,
): IMiddlewarePipelineBuilder<TContext> {
  app.register((x) => addBenzeneInvocation(x));
  return app.useFn('BenzeneInvocation', async (context, next, serviceResolver) => {
    serviceResolver.getService(IBenzeneInvocationAccessor).invocation = factory(
      serviceResolver,
      context,
    );
    await next();
  });
}
