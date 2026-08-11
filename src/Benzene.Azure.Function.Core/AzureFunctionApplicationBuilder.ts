import { IBenzeneServiceContainer, IServiceResolverFactory } from '@benzene/abstractions';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { BenzeneApplicationBuilder } from '@benzene/core-middleware';
import { AzureEntryPointApplication, AzureFunctionApp } from './AzureFunctionApp';
import { IAzureFunctionApp } from './IAzureFunctionApp';
import { IAzureFunctionAppBuilder } from './IAzureFunctionAppBuilder';

/**
 * Port of Benzene.Azure.Function.Core.AzureFunctionAppBuilder — the host-neutral shape.
 *
 * The Azure counterpart of `AwsLambdaApplicationBuilder`: a `BenzeneApplicationBuilder` (so it IS an
 * `IBenzeneApplicationBuilder`, the one builder a unified {@link BenzeneStartUp}'s `configure(app)`
 * receives) that ALSO implements `IAzureFunctionAppBuilder` (so the trigger extensions `useAzureHttp`,
 * `useServiceBus`, `useEventHub`, … can be wired straight onto it). `useAzureFunctions(app, az => …)`
 * hands `az` out as this same object, exactly as `useAwsLambda(app, aws => …)` hands out
 * `app.eventPipeline`.
 *
 * WHY IT SUPERSEDES `AzureFunctionAppBuilder`: the original {@link AzureFunctionAppBuilder} implements
 * `IAzureFunctionAppBuilder` directly (it predates the ported neutral host base), so an Azure startup had
 * to take the per-cloud `IAzureFunctionAppBuilder` in `configure` — the deferred generic-host bootstrap
 * the AWS side already resolved. This builder closes that gap by deriving from the neutral base while
 * keeping the identical `IAzureFunctionAppBuilder` surface, so it is a drop-in for BOTH a unified
 * `configure(app: IBenzeneApplicationBuilder)` (via `useAzureFunctions`) and a legacy
 * `configure(app: IAzureFunctionAppBuilder)` (which receives it directly and calls `useAzureHttp(app, …)`
 * on it). `AzureFunctionAppBuilder` is retained, unchanged, for `InlineAzureFunctionStartUp` and existing
 * consumers.
 */
export class AzureFunctionApplicationBuilder
  extends BenzeneApplicationBuilder
  implements IAzureFunctionAppBuilder
{
  /** The platform name identifier for Azure Functions. */
  static readonly platformName = 'AzureFunctions';

  private readonly apps: ((
    serviceResolverFactory: IServiceResolverFactory,
  ) => AzureEntryPointApplication)[] = [];

  /**
   * @param benzeneServiceContainer The service container used for registrations and pipeline building.
   */
  constructor(benzeneServiceContainer: IBenzeneServiceContainer) {
    super(AzureFunctionApplicationBuilder.platformName, benzeneServiceContainer);
  }

  add(func: (serviceResolverFactory: IServiceResolverFactory) => AzureEntryPointApplication): void {
    this.apps.push(func);
  }

  createApp(serviceResolverFactory: IServiceResolverFactory): IAzureFunctionApp {
    return new AzureFunctionApp([...this.apps], serviceResolverFactory);
  }
}

/**
 * Port of Benzene.Azure.Function.Core.AzureFunctionAppBuilderExtensions.UseBenzeneInvocation, adapted to
 * the AWS `useAwsLambda` shape.
 *
 * Applies Azure Functions-specific configuration to a platform-neutral `IBenzeneApplicationBuilder`: hands
 * the caller the `IAzureFunctionAppBuilder` on which to wire the triggers (`useAzureHttp(az, …)`,
 * `useServiceBus(az, …)`, `useEventHub(az, …)`). No-op on other platforms (the C# extension-method → free-
 * function convention; `app is AzureFunctionApplicationBuilder` → `instanceof`), so the SAME neutral
 * `StartUp.configure(app, config)` can select Azure with `useAzureFunctions` exactly as it selects AWS
 * with `useAwsLambda`.
 */
export function useAzureFunctions(
  app: IBenzeneApplicationBuilder,
  configure: (azureFunctionApp: IAzureFunctionAppBuilder) => void,
): IBenzeneApplicationBuilder {
  if (app instanceof AzureFunctionApplicationBuilder) {
    configure(app);
  }
  return app;
}
