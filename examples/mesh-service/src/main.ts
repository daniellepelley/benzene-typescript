/**
 * CLI entry point: starts the order service and prints the endpoints a mesh aggregator (or `curl`) can hit.
 * Run with `npm start -w @benzene-example/mesh-service` (or `PORT=5100 tsx src/main.ts`).
 */
import { startOrderService } from './orderService';

const port = Number(process.env['PORT'] ?? 5100);
const service = await startOrderService(port);

console.log(`Benzene order service (TypeScript) listening on ${service.url}`);
console.log(`  mesh spec:   GET  ${service.url}/benzene/spec?type=benzene`);
console.log(`  mesh health: GET  ${service.url}/benzene/health`);
console.log(`  create order: POST ${service.url}/orders   {"customerId":"acme"}`);
console.log(`  get order:    GET  ${service.url}/orders/1`);
console.log('Point a mesh aggregator (TypeScript or .NET) at the spec + health URLs to catalog this service.');
