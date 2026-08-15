/**
 * The analytics-api Function App's registrations: the catch-all HTTP trigger (Cloud Service Profile) plus
 * an Event Grid trigger on `payment:captured` + `shipment:dispatched` (one event, many subscriptions —
 * shared with notifications). TWO separate `AzureFunctionHost`s — see `src/startUps.ts`'s file header for
 * why.
 */
import { app, InvocationContext } from '@azure/functions';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import { handleEventGridEvent } from '@benzenejs/azure-function-event-grid';
import { AnalyticsEventGridStartUp, AnalyticsHttpStartUp } from '../src/startUps';

const httpHost = new AzureFunctionHost(AnalyticsHttpStartUp);
const eventGridHost = new AzureFunctionHost(AnalyticsEventGridStartUp);

app.http('analytics-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.eventGrid('analytics-eg', {
  handler: (event: unknown, _context: InvocationContext) => handleEventGridEvent(eventGridHost.app, JSON.stringify(event)),
});
