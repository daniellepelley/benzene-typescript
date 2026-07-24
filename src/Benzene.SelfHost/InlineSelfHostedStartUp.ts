import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IBenzeneWorker } from '@benzene/abstractions-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneWorkerBuilder } from './BenzeneWorkerBuilder';
import { IBenzeneWorkerStartup } from './IBenzeneWorkerStartup';

/** Builds a ready-to-run {@link IBenzeneWorker}. Port of Benzene.SelfHost.IBenzeneWorkerBuilder. */
export interface IBenzeneWorkerBuilder {
  build(): IBenzeneWorker;
}

/**
 * A minimal, fluent self-hosted startup: register services and configure workers inline, then `build`
 * a composite worker - the no-ceremony alternative to a full `BenzeneStartUp` subclass.
 * Port of Benzene.SelfHost.InlineSelfHostedStartUp.
 *
 * C# builds over `new ServiceCollection()` + `MicrosoftBenzeneServiceContainer`/
 * `MicrosoftServiceResolverFactory`; the port uses `DefaultBenzeneServiceContainer` from
 * `@benzene/dependencies`, which is both the registration surface and the resolver-factory source - so
 * C#'s separate `Action<IServiceCollection>` becomes an `Action<IBenzeneServiceContainer>`.
 */
export class InlineSelfHostedStartUp implements IBenzeneWorkerBuilder {
  private servicesAction: (container: IBenzeneServiceContainer) => void = () => {};
  private appAction: (app: IBenzeneWorkerStartup) => void = () => {};

  configureServices(action: (container: IBenzeneServiceContainer) => void): InlineSelfHostedStartUp {
    this.servicesAction = action;
    return this;
  }

  configure(action: (app: IBenzeneWorkerStartup) => void): InlineSelfHostedStartUp {
    this.appAction = action;
    return this;
  }

  build(): IBenzeneWorker {
    const container = new DefaultBenzeneServiceContainer();
    const app = new BenzeneWorkerBuilder(container);

    this.appAction(app);
    this.servicesAction(container);

    return app.createWorker(container.createServiceResolverFactory());
  }
}
