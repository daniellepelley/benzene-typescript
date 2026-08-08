/**
 * The runnable entry point — starts the Express order service. Run with:
 *
 *     npm start -w @benzene-example/express-http
 *
 * then `curl -X POST localhost:3000/orders -d '{"name":"acme"}'` and `curl localhost:3000/orders`.
 */
import { createOrderService } from './orderService';

const port = Number(process.env['PORT'] ?? 3000);
createOrderService().listen(port, () => {
  console.log(`benzene express order service listening on http://localhost:${port}`);
});
