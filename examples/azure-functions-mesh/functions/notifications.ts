/**
 * The notifications-api Function App's registrations: the catch-all HTTP trigger (Cloud Service Profile),
 * an Event Hub trigger on `order:placed` (notifications' own consumer group, fanned out alongside
 * inventory), and an Event Grid trigger on `payment:captured` + `shipment:dispatched`. THREE separate
 * `AzureFunctionHost`s — see `src/startUps.ts`'s file header for why.
 */
import { app, InvocationContext } from '@azure/functions';
import type { ReceivedEventData } from '@azure/event-hubs';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import '@benzenejs/azure-function-event-hub';
import { handleEventGridEvent } from '@benzenejs/azure-function-event-grid';
import { NotificationsEventGridStartUp, NotificationsEventHubStartUp, NotificationsHttpStartUp } from '../src/startUps';

const httpHost = new AzureFunctionHost(NotificationsHttpStartUp);
const eventHubHost = new AzureFunctionHost(NotificationsEventHubStartUp);
const eventGridHost = new AzureFunctionHost(NotificationsEventGridStartUp);

app.http('notifications-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.eventHub('notifications-eh', {
  connection: 'EventHubConnection',
  eventHubName: process.env['ORDER_PLACED_HUB'] ?? 'order-placed',
  consumerGroup: 'notifications',
  cardinality: 'many',
  handler: (events: unknown, _context: InvocationContext) => eventHubHost.eventHubFunction(events as ReceivedEventData[]),
});

app.eventGrid('notifications-eg', {
  handler: (event: unknown, _context: InvocationContext) => handleEventGridEvent(eventGridHost.app, JSON.stringify(event)),
});
