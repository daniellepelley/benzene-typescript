/** Port of Benzene.Azure.Function.Core.AzureFunctionAppBuilder. */
import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder, RegisterDependency } from '@benzene/core-middleware';
import { AzureFunctionApp, AzureEntryPointApplication } from './AzureFunctionApp';
import { IAzureFunctionApp } from './IAzureFunctionApp';
import { IAzureFunctionAppBuilder } from './IAzureFunctionAppBuilder';

/**
 * Default implementation of `IAzureFunctionAppBuilder`.
 *
 * HOST-BASE DEVIATION: the .NET `AzureFunctionAppBuilder` derives from the platform-neutral
 * `BenzeneApplicationBuilder` (which implements `IBenzeneApplicationBuilder`) so a single
 * `BenzeneStartUp` can be hosted identically on any Benzene host. That generic-host bootstrap
 * (`IBenzeneApplicationBuilder` / `BenzeneStartUp` / `HostBuilderExtensions` /
 * `FunctionsWorkerApplicationBuilderExtensions`) is not yet ported — the same treatment given to the
 * AWS `AwsLambdaHost` / `BenzeneApplicationBuilder`. So this port implements `IAzureFunctionAppBuilder`
 * directly over a `RegisterDependency` wrapping the container, mirroring how `InlineAwsLambdaStartUp`
 * drives `MiddlewarePipelineBuilder` straight off `DefaultBenzeneServiceContainer`. `create<T>()`
 * shares the SAME registration target so every pipeline and every `register` call lands in one
 * container.
 */
export class AzureFunctionAppBuilder implements IAzureFunctionAppBuilder {
  /** The platform identifier reported by the .NET host base. Kept for parity/documentation. */
  static readonly platformName = 'AzureFunctions';

  private readonly registerDependency: RegisterDependency;
  private readonly apps: ((
    serviceResolverFactory: IServiceResolverFactory,
  ) => AzureEntryPointApplication)[] = [];

  /**
   * @param benzeneServiceContainer The service container used for registrations and pipeline building.
   */
  constructor(benzeneServiceContainer: IBenzeneServiceContainer) {
    this.registerDependency = new RegisterDependency(benzeneServiceContainer);
  }

  register(action: (container: IBenzeneServiceContainer) => void): void {
    this.registerDependency.register(action);
  }

  add(func: (serviceResolverFactory: IServiceResolverFactory) => AzureEntryPointApplication): void {
    this.apps.push(func);
  }

  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext> {
    // Share the same registration target so all pipelines register into one container.
    return new MiddlewarePipelineBuilder<TNewContext>(this.registerDependency);
  }

  createApp(serviceResolverFactory: IServiceResolverFactory): IAzureFunctionApp {
    return new AzureFunctionApp([...this.apps], serviceResolverFactory);
  }
}
