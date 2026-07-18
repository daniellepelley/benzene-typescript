/** Port of Benzene.Azure.Function.Core.IAzureFunctionAppBuilder. */
import { IRegisterDependency, IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { IAzureFunctionApp } from './IAzureFunctionApp';
import { AzureEntryPointApplication } from './AzureFunctionApp';

/**
 * Builds an `IAzureFunctionApp` by collecting entry point applications and providing middleware
 * pipeline creation and service registration.
 *
 * Extends `IRegisterDependency` (the port of C#'s `IRegisterDependency`, itself reached via the
 * unported `IBenzeneApplicationBuilder` host base in .NET — see `AzureFunctionAppBuilder`).
 *
 * OVERLOAD SPLIT: C# overloads `Create` on arity — `Create<TNewContext>()` (a new pipeline builder)
 * and `Create(IServiceResolverFactory)` (the built app). Both are indistinguishable enough at runtime
 * that the port splits them by name: `create<TNewContext>()` builds a pipeline builder and
 * `createApp(serviceResolverFactory)` builds the app.
 */
export interface IAzureFunctionAppBuilder extends IRegisterDependency {
  /**
   * Registers a factory for an entry point application to be included in the built `IAzureFunctionApp`.
   * @param func A factory that creates the entry point application for the current invocation's resolver factory.
   */
  add(func: (serviceResolverFactory: IServiceResolverFactory) => AzureEntryPointApplication): void;

  /**
   * Creates a new middleware pipeline builder for a given context type, sharing this builder's
   * underlying service container. Port of C# `Create<TNewContext>()`.
   */
  create<TNewContext>(): IMiddlewarePipelineBuilder<TNewContext>;

  /**
   * Builds the `IAzureFunctionApp` from the registered entry point application factories.
   * Port of C# `Create(IServiceResolverFactory)`.
   * @param serviceResolverFactory The service resolver factory used to construct each entry point application.
   */
  createApp(serviceResolverFactory: IServiceResolverFactory): IAzureFunctionApp;
}
