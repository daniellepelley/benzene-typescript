/**
 * Entry point for the mesh image: discovers the three domain services, serves the Mesh UI + catalog
 * artifacts, and hosts the live collector. Mirrors .NET K8sMesh's `Mesh/Program.cs` +
 * `MeshAggregationBackgroundService`.
 *
 * Run standalone (no cluster; discovery finds nothing without an in-cluster Kubernetes API — see
 * `meshApp.ts`'s fallback — but the UI and the refresh endpoint still serve `{"discovered":0}`):
 *
 *     PORT=8080 MESH_ARTIFACT_DIR=/tmp/k8s-mesh-artifacts npx tsx examples/k8s-mesh/src/meshIndex.ts
 */
import { createMeshApp } from './meshApp';
import { startBackgroundAggregation } from './meshAggregation';

const port = Number(process.env['PORT'] ?? 8080);
const artifactDir = process.env['MESH_ARTIFACT_DIR'] ?? '/artifacts';

const { app, aggregation } = createMeshApp(artifactDir);

// Re-runs discovery + aggregation on an interval so the catalog stays fresh without anyone hitting
// /mesh/refresh — the Kubernetes analogue of .NET's MeshAggregationBackgroundService. Shares the exact
// MeshAggregator/MeshDiscoveryRunner pair POST /mesh/refresh uses (see createMeshApp), so both entry
// points into a pass write the same artifacts, not two independently-constructed pipelines. A transient
// discovery/interrogation failure never crashes the process — see startBackgroundAggregation.
const stopBackgroundAggregation = startBackgroundAggregation(aggregation);

const server = app.listen(port, () => {
  console.log(`mesh listening on http://localhost:${port} (artifacts: ${artifactDir})`);
});

process.on('SIGTERM', () => {
  stopBackgroundAggregation();
  server.close();
});
process.on('SIGINT', () => {
  stopBackgroundAggregation();
  server.close();
});
