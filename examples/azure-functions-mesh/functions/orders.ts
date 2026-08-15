/**
 * The orders-api Function App's registrations — the `@azure/functions` v4 side of the trigger: a single
 * catch-all HTTP trigger serving `/benzene/spec`, `/benzene/health`, `/benzene/invoke`, and `POST
 * /orders`. `host.json`'s `routePrefix: ""` (see `../host.json`) makes those paths match the mesh's
 * default discovery URLs. `authLevel: 'anonymous'` — the mesh's interrogation carries no function key,
 * matching every other Cloud Service in this example.
 */
import { app } from '@azure/functions';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import { OrdersStartUp } from '../src/startUps';

const host = new AzureFunctionHost(OrdersStartUp);

app.http('orders-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: host.httpFunction,
});
