import { IRegisterDependency, IServiceResolverFactory } from '@benzene/abstractions';
import { IBenzeneWorker, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';

/**
 * The worker-registration surface a self-hosted `BenzeneStartUp.Configure` builds against: register
 * worker factories, create per-context middleware pipelines, and (at host start) materialize the
 * composite worker for a given resolver factory.
 * Port of Benzene.SelfHost.IBenzeneWorkerStartup.
 */
export interface IBenzeneWorkerStartup extends IRegisterDependency {
  /** Registers a factory that builds one worker from the invocation's resolver factory. */
  add(func: (serviceResolverFactory: IServiceResolverFactory) => IBenzeneWorker): void;

  /** Creates a middleware pipeline builder for a new context type. */
  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext>;

  /** Materializes all registered workers as a single composite worker over the given resolver factory. */
  createWorker(serviceResolverFactory: IServiceResolverFactory): IBenzeneWorker;
}
