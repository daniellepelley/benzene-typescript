/** Port of Benzene.Mesh.Usage.ApplicationInsights.Extensions. */
import { DefaultAzureCredential } from '@azure/identity';
import { LogsQueryClient } from '@azure/monitor-query';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMeshUsageSource } from '@benzene/mesh-contracts';
import { ApplicationInsightsUsageOptions } from './ApplicationInsightsUsageOptions';
import { ApplicationInsightsUsageSource } from './ApplicationInsightsUsageSource';
import { IApplicationInsightsUsageQuery } from './IApplicationInsightsUsageQuery';
import { LogsQueryUsageQuery } from './LogsQueryUsageQuery';

/**
 * Registers an `ApplicationInsightsUsageSource` as an `IMeshUsageSource`, so `@benzene/mesh-aggregator` reads
 * the `benzene.messages.processed` counter back from the Application Insights / Log Analytics workspace each
 * run and merges it into `usage.json`.
 *
 * Registers a default `LogsQueryClient` authenticated with `DefaultAzureCredential` (the ambient managed
 * identity on Azure) and the default KQL query seam. Requires `addMeshAggregator(...)` in the same
 * container - the aggregator resolves every registered source per run. `Azure.Monitor.Query`/`Azure.Identity`
 * -> `@azure/monitor-query`/`@azure/identity`.
 */
export function addApplicationInsightsUsage(
  services: IBenzeneServiceContainer,
  options: ApplicationInsightsUsageOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(ApplicationInsightsUsageOptions, options);
  services.addSingletonFactory(IApplicationInsightsUsageQuery, () => new LogsQueryUsageQuery(new LogsQueryClient(new DefaultAzureCredential())));
  services.addSingletonFactory(
    IMeshUsageSource,
    (resolver) => new ApplicationInsightsUsageSource(resolver.getService(IApplicationInsightsUsageQuery), resolver.getService(ApplicationInsightsUsageOptions)),
  );
  return services;
}
