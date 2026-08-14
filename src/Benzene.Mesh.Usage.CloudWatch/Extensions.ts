/** Port of Benzene.Mesh.Usage.CloudWatch.Extensions. */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMeshUsageSource } from '@benzenejs/mesh-contracts';
import { CloudWatchUsageOptions } from './CloudWatchUsageOptions';
import { CloudWatchUsageSource } from './CloudWatchUsageSource';

/**
 * Registers a `CloudWatchUsageSource` as an `IMeshUsageSource`, so `@benzenejs/mesh-aggregator` reads the
 * `benzene.messages.processed` counter back from CloudWatch each run and merges it into `usage.json`.
 *
 * Registers a default `CloudWatchClient` (region + credentials from the ambient AWS environment - on Lambda,
 * the execution role). Requires `addMeshAggregator(...)` in the same container - the aggregator resolves
 * every registered source per run. `Azure`/`AWSSDK.CloudWatch` -> `@aws-sdk/client-cloudwatch`.
 */
export function addCloudWatchUsage(
  services: IBenzeneServiceContainer,
  options: CloudWatchUsageOptions,
): IBenzeneServiceContainer {
  services.addSingletonInstance(CloudWatchUsageOptions, options);
  const cloudWatch = new CloudWatchClient({});
  services.addSingletonFactory(
    IMeshUsageSource,
    (resolver) => new CloudWatchUsageSource(cloudWatch, resolver.getService(CloudWatchUsageOptions)),
  );
  return services;
}
