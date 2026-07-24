import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { IBenzeneWorker, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { CompositeBenzeneWorker } from './CompositeBenzeneWorker';
import { IBenzeneWorkerStartup } from './IBenzeneWorkerStartup';

/**
 * Default {@link IBenzeneWorkerStartup}: collects worker factories and, at host start, materializes them
 * into one {@link CompositeBenzeneWorker} bound to the invocation's resolver factory.
 * Port of Benzene.SelfHost.BenzeneWorkerBuilder.
 *
 * C#'s `IBenzeneWorkerStartup.Create(IServiceResolverFactory)` (the worker-materialization overload of
 * `Create`) is named `createWorker` here to disambiguate from the generic pipeline-builder `create`,
 * since TypeScript can't overload a generic no-arg method against a one-arg method as cleanly as C#.
 */
export class BenzeneWorkerBuilder implements IBenzeneWorkerStartup {
  private readonly apps: Array<(serviceResolverFactory: IServiceResolverFactory) => IBenzeneWorker> = [];

  constructor(private readonly benzeneServiceContainer: IBenzeneServiceContainer) {}

  add(func: (serviceResolverFactory: IServiceResolverFactory) => IBenzeneWorker): void {
    this.apps.push(func);
  }

  register(action: (container: IBenzeneServiceContainer) => void): void {
    action(this.benzeneServiceContainer);
  }

  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext> {
    return new MiddlewarePipelineBuilder<TNewContext>(this.benzeneServiceContainer);
  }

  createWorker(serviceResolverFactory: IServiceResolverFactory): IBenzeneWorker {
    return new CompositeBenzeneWorker(this.apps.map((x) => x(serviceResolverFactory)));
  }
}
