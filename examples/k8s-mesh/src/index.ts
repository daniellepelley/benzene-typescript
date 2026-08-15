/**
 * Entry point for the shared Cloud Service image: `MESH_SERVICE` picks the domain
 * (orders/payments/shipping); `PORT` is the port Kubernetes probes/Service target
 * (`benzene/health` on the same port). Mirrors .NET K8sMesh's `Service/Program.cs`.
 *
 * Run standalone (no cluster):
 *
 *     MESH_SERVICE=orders PORT=8081 npx tsx examples/k8s-mesh/src/index.ts
 */
import { createServiceApp } from './serviceApp';

const serviceName = process.env['MESH_SERVICE'] ?? 'orders';
const port = Number(process.env['PORT'] ?? 8080);

createServiceApp(serviceName).listen(port, () => {
  console.log(`${serviceName}-api listening on http://localhost:${port}`);
});
