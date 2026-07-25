/**
 * Port of Benzene.Mesh.Usage.ApplicationInsights - an `IMeshUsageSource` that reads the
 * `benzene.messages.processed` counter back from Azure Monitor / Application Insights (via a KQL query over
 * the Log Analytics `customMetrics` table) and reports it as the mesh usage feed. The pure
 * `ApplicationInsightsUsageSource` sits over the `IApplicationInsightsUsageQuery` seam, whose default
 * implementation (`LogsQueryUsageQuery`) adapts `Azure.Monitor.Query` to `@azure/monitor-query`. Wired via
 * `addApplicationInsightsUsage`. The Azure sibling of the CloudWatch usage adapter.
 */
export * from './ApplicationInsightsUsageOptions';
export * from './IApplicationInsightsUsageQuery';
export * from './ApplicationInsightsUsageSource';
export * from './LogsQueryUsageQuery';
export * from './Extensions';
