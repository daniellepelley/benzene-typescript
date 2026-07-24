/** Port of Benzene.Mesh.Reporting.MeshReportingOptions. */

/** Configures where `HttpMeshReportPublisher` posts self-reports. Resolved from the container by its class. */
export class MeshReportingOptions {
  /** @param ingestionUrl The aggregator's ingestion endpoint (e.g. `https://mesh.internal/mesh/report`). */
  constructor(readonly ingestionUrl: string) {}
}
