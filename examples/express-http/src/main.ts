/**
 * The runnable entry point — starts the Express order service. Run with:
 *
 *     npm start -w @benzene-example/express-http
 *
 * then `curl -X POST localhost:3000/orders -d '{"name":"acme"}'` and `curl localhost:3000/orders`.
 *
 * This example DELIBERATELY owns its own `listen` rather than using `BenzeneHost.runAsync` — the whole
 * point of the strangler-fig shape is that the Express app is yours and Benzene is middleware inside it,
 * so the process lifecycle stays yours too. When Benzene should own the listener instead, declare it with
 * `useExpress` in a startup and the entry point becomes one line: see `examples/k8s-orders`.
 */
import { createOrderService } from './orderService';

const port = Number(process.env['PORT'] ?? 3000);
createOrderService().listen(port, () => {
  console.log(`benzene express order service listening on http://localhost:${port}`);
});
