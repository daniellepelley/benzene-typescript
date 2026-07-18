/** Port of Benzene.Azure.Function.Core.InlineAzureFunctionStartUp. */
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { AzureFunctionAppBuilder } from './AzureFunctionAppBuilder';
import { IAzureFunctionApp } from './IAzureFunctionApp';
import { IAzureFunctionAppBuilder } from './IAzureFunctionAppBuilder';

/**
 * Provides an inline, fluent alternative to a dedicated startup class for building an
 * `IAzureFunctionApp` — useful for tests and small standalone hosts.
 *
 * Deviation from .NET: the original is bound to `Microsoft.Extensions.DependencyInjection`
 * (`ConfigureServices(Action<IServiceCollection>)` + `MicrosoftBenzeneServiceContainer` +
 * `MicrosoftServiceResolverFactory`). Node has no such platform container, so — exactly as
 * `InlineAwsLambdaStartUp` was adapted — it uses the first-party `DefaultBenzeneServiceContainer`,
 * and `configureServices` takes an `(services: IBenzeneServiceContainer) => void` action. The single
 * container is both the registration target for the builder and the source of the resolver factory.
 */
export class InlineAzureFunctionStartUp {
  private servicesAction: (services: IBenzeneServiceContainer) => void = () => {};
  private appAction: (app: IAzureFunctionAppBuilder) => void = () => {};

  /** Registers an action that configures services with the container. Port of C# `ConfigureServices`. */
  configureServices(
    action: (services: IBenzeneServiceContainer) => void,
  ): InlineAzureFunctionStartUp {
    this.servicesAction = action;
    return this;
  }

  /** Registers an action that configures the entry point applications. Port of C# `Configure`. */
  configure(action: (app: IAzureFunctionAppBuilder) => void): InlineAzureFunctionStartUp {
    this.appAction = action;
    return this;
  }

  /** Builds the `IAzureFunctionApp` from the configured actions. Port of C# `Build`. */
  build(): IAzureFunctionApp {
    const container = new DefaultBenzeneServiceContainer();
    const app = new AzureFunctionAppBuilder(container);

    // Same order as the .NET original: configure the app builder, then register services.
    this.appAction(app);
    this.servicesAction(container);

    return app.createApp(container.createServiceResolverFactory());
  }
}
