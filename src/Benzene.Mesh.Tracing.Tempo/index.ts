/**
 * Port of Benzene.Mesh.Tracing.Tempo - the observed-traffic topology source. Queries Grafana Tempo's
 * metrics-generator service-graph metrics via a Prometheus-compatible endpoint (`PrometheusQueryClient`) and
 * assembles a `MeshTopology` of `TopologyEdgeSource.tempo` edges (`TempoServiceGraphTopologyBuilder`),
 * published as `topology.json` by `TempoTopologyMessageHandler` and wired via `addTempoTopology`.
 */
export * from './TempoTopologyOptions';
export * from './PrometheusSample';
export * from './PrometheusQueryClient';
export * from './TempoServiceGraphTopologyBuilder';
export * from './TempoTopologyMessageHandler';
export * from './Extensions';
