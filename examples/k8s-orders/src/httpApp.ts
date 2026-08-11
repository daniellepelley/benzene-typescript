/**
 * The HTTP leg: an ordinary Express app exposing `POST /orders`. There is nothing Kubernetes-specific
 * here — it's hosted exactly like [Getting Started](../../../docs/getting-started.md), just pointed at
 * the shared `PlaceOrderHandler` instead of one it defines itself.
 */
import express, { type Express } from 'express';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { benzene } from '@benzene/express';
import { PlaceOrderHandler } from './domain.js';

export function createOrderApp(): Express {
  const app = express();

  app.use(benzene((pipeline) => useMessageHandlers(pipeline, PlaceOrderHandler)));

  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
