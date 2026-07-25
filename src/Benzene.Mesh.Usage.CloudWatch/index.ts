/**
 * Port of Benzene.Mesh.Usage.CloudWatch - an `IMeshUsageSource` that reads the `benzene.messages.processed`
 * counter back from CloudWatch (`ListMetrics` to enumerate live dimension combinations, one `GetMetricData`
 * `Sum` query each) and reports it as the mesh usage feed. Wired via `addCloudWatchUsage`. Adapts
 * `AWSSDK.CloudWatch` to `@aws-sdk/client-cloudwatch`. The AWS sibling of the Application Insights adapter.
 */
export * from './CloudWatchUsageOptions';
export * from './CloudWatchUsageSource';
export * from './Extensions';
