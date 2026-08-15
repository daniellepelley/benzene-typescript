/**
 * The mesh Function App's registrations: the catch-all HTTP trigger (Mesh UI, Spec UI, catalog artifacts,
 * `POST /mesh/refresh`) and the timer trigger running the discovery + aggregation pass on a schedule. TWO
 * separate `AzureFunctionHost`s — see `src/startUps.ts`'s file header for why. `@benzenejs/azure-function-
 * timer` has no `.timerFunction` host getter (unlike HTTP/Service Bus/Event Hub), so its dispatch is
 * wired directly with `handleTimer`. `runOnStartup: true` warms the catalog on a cold start (a fetch
 * against a still-cold sibling Function App would otherwise time out and flash "unreachable" until it
 * warms — see the README's "Known first-deploy iteration points", ported from .NET's own
 * AzureFunctionsMesh).
 */
import { app, InvocationContext } from '@azure/functions';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import { handleTimer } from '@benzenejs/azure-function-timer';
import { MeshHttpStartUp, MeshTimerStartUp } from '../src/mesh/meshStartUp';

const httpHost = new AzureFunctionHost(MeshHttpStartUp);
const timerHost = new AzureFunctionHost(MeshTimerStartUp);

app.http('mesh-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.timer('mesh-aggregate', {
  schedule: '0 */1 * * * *',
  runOnStartup: true,
  handler: (_myTimer: unknown, _context: InvocationContext) => handleTimer(timerHost.app),
});
