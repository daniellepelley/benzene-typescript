import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder, IBenzeneWorker } from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { BenzeneWorkerBuilder } from './BenzeneWorkerBuilder';
import { IBenzeneWorkerStartup } from './IBenzeneWorkerStartup';

/**
 * The `IBenzeneApplicationBuilder` for the self-hosted worker platform ("Worker"): adds a worker
 * registry (`workers`) alongside the base pipeline/registration plumbing, and materializes the
 * composite worker at host start.
 * Port of Benzene.SelfHost.WorkerApplicationBuilder.
 */
export class WorkerApplicationBuilder extends BenzeneApplicationBuilder {
  static readonly platformName = 'Worker';
  private readonly workerStartup: BenzeneWorkerBuilder;

  constructor(benzeneServiceContainer: IBenzeneServiceContainer) {
    super(WorkerApplicationBuilder.platformName, benzeneServiceContainer);
    this.workerStartup = new BenzeneWorkerBuilder(benzeneServiceContainer);
  }

  get workers(): IBenzeneWorkerStartup {
    return this.workerStartup;
  }

  createWorker(serviceResolverFactory: IServiceResolverFactory): IBenzeneWorker {
    return this.workerStartup.createWorker(serviceResolverFactory);
  }
}

/**
 * Applies worker-host-specific configuration; a no-op on other platforms. Port of the C# extension
 * method `UseWorker` -> a free function taking the builder first.
 */
export function useWorker(
  app: IBenzeneApplicationBuilder,
  configure: (workers: IBenzeneWorkerStartup) => void,
): IBenzeneApplicationBuilder {
  if (app instanceof WorkerApplicationBuilder) {
    configure(app.workers);
  }
  return app;
}
