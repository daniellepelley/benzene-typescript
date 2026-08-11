/**
 * The runnable HTTP entry point — starts the Express order API on the port Kubernetes gives the
 * container (the readinessProbe and Service target this). Run with:
 *
 *     npm start -w @benzene-example/k8s-orders
 *
 * then `curl -XPOST localhost:8080/orders -H 'content-type: application/json' \
 *   -d '{"customerId":"c-1","sku":"widget","quantity":3}'`.
 */
import { createOrderApp } from './httpApp.js';

const port = Number(process.env['PORT'] ?? 8080);
createOrderApp().listen(port, () => {
  console.log(`orders-api listening on http://localhost:${port}`);
});
