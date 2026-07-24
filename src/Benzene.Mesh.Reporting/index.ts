/**
 * Port of Benzene.Mesh.Reporting - push-based mesh self-reporting for services an aggregator can't poll:
 * `HttpMeshReportPublisher` (POSTs a `MeshServiceReport` to an aggregator's ingestion endpoint) and
 * `MeshSelfReportMiddleware` (opportunistically publishes the service's own spec/health after real traffic,
 * throttled and best-effort), wired via `addMeshHttpReporting`/`addMeshSelfReport`/`useMeshSelfReport`.
 */
export * from './MeshReportingOptions';
export * from './HttpMeshReportPublisher';
export * from './MeshSelfReportOptions';
export * from './MeshSelfReportState';
export * from './MeshSelfReportMiddleware';
export * from './Extensions';
