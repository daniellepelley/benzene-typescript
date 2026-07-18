import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { AwsEventStreamContext } from './AwsEventStream/AwsEventStreamContext';
import { AwsLambdaEntryPoint } from './AwsLambdaEntryPoint';
import { IAwsEntryPointBuilder } from './IAwsEntryPointBuilder';
import { IAwsLambdaEntryPoint } from './IAwsLambdaEntryPoint';

/**
 * Port of Benzene.Aws.Lambda.Core.InlineAwsLambdaStartUp.
 *
 * A fluent, inline alternative to declaring a StartUp subclass — primarily for tests and small
 * samples: register services and configure the `AwsEventStreamContext` pipeline, then `build()` an
 * entry point.
 *
 * Deviation from .NET: the original is bound to `Microsoft.Extensions.DependencyInjection`
 * (`ConfigureServices(Action<IServiceCollection>)` + `MicrosoftBenzeneServiceContainer`). Node has no
 * such platform container, so — matching the rest of this port — it uses the first-party
 * `DefaultBenzeneServiceContainer`, and `configureServices` takes an
 * `(services: IBenzeneServiceContainer) => void` action. The platform-neutral host model
 * (`AwsLambdaHost<TStartUp>` / `AwsLambdaApplicationBuilder` / `BenzeneStartUp`) is deferred until the
 * hosting abstractions are ported; see this package's notes.
 */
export class InlineAwsLambdaStartUp implements IAwsEntryPointBuilder {
  private servicesAction: (services: IBenzeneServiceContainer) => void = () => {};
  private appAction: PipelineBuilderAction<AwsEventStreamContext> = () => {};

  /** Configures the action used to register services. Port of C# `ConfigureServices`. */
  configureServices(action: (services: IBenzeneServiceContainer) => void): InlineAwsLambdaStartUp {
    this.servicesAction = action;
    return this;
  }

  /** Configures the action used to build the middleware pipeline. Port of C# `Configure`. */
  configure(action: PipelineBuilderAction<AwsEventStreamContext>): InlineAwsLambdaStartUp {
    this.appAction = action;
    return this;
  }

  /** Builds the Lambda entry point from the configured actions. Port of C# `Build`. */
  build(): IAwsLambdaEntryPoint {
    const container = new DefaultBenzeneServiceContainer();
    const app = new MiddlewarePipelineBuilder<AwsEventStreamContext>(container);

    // Same order as the .NET original: configure the pipeline, then register services.
    this.appAction(app);
    this.servicesAction(container);

    return new AwsLambdaEntryPoint(app.build(), container.createServiceResolverFactory());
  }
}
