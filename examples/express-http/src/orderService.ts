/**
 * Assembles the runnable Express app: `@benzene/express` owns the message routes (`POST /orders`,
 * `GET /orders`), and everything else falls through to ordinary Express routes — the strangler-fig pattern.
 * The order store is registered on a container handed to `benzene(...)`, so the handlers get it injected.
 */
import express, { type Express } from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { CreateOrderHandler, ListOrdersHandler } from './handlers';
import { IOrderStore, InMemoryOrderStore } from './orderStore';

/** Builds the Express app: Benzene owns the order routes; a plain `/healthz` route shows the fallthrough. */
export function createOrderService(): Express {
  const app = express();

  const container = new DefaultBenzeneServiceContainer();
  container.addSingletonInstance(IOrderStore, new InMemoryOrderStore());

  // Benzene owns POST /orders and GET /orders (mounted before any body parser so it reads the raw body).
  app.use(
    benzene((pipeline) => useMessageHandlers(pipeline, CreateOrderHandler, ListOrdersHandler), {
      container,
    }),
  );

  // A plain Express route Benzene owns no handler for — reached via the strangler fallback.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
