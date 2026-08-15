/**
 * The inventory-api Function App's registrations: the catch-all HTTP trigger (Cloud Service Profile),
 * an Event Hub trigger on `order:placed` (inventory's own consumer group — see `deploy/main.tf`), and an
 * Event Grid trigger on `shipment:dispatched`. THREE separate `AzureFunctionHost`s (one per trigger) —
 * see `src/startUps.ts`'s file header for why. `@benzenejs/azure-function-event-grid` has no
 * `.eventGridFunction` host getter (unlike HTTP/Service Bus/Event Hub), so its dispatch is wired directly
 * with `handleEventGridEvent`.
 */
import { app, InvocationContext } from '@azure/functions';
import type { ReceivedEventData } from '@azure/event-hubs';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import '@benzenejs/azure-function-event-hub';
import { handleEventGridEvent } from '@benzenejs/azure-function-event-grid';
import { InventoryEventGridStartUp, InventoryEventHubStartUp, InventoryHttpStartUp } from '../src/startUps';

const httpHost = new AzureFunctionHost(InventoryHttpStartUp);
const eventHubHost = new AzureFunctionHost(InventoryEventHubStartUp);
const eventGridHost = new AzureFunctionHost(InventoryEventGridStartUp);

app.http('inventory-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.eventHub('inventory-eh', {
  connection: 'EventHubConnection',
  eventHubName: process.env['ORDER_PLACED_HUB'] ?? 'order-placed',
  consumerGroup: 'inventory',
  cardinality: 'many',
  handler: (events: unknown, _context: InvocationContext) => eventHubHost.eventHubFunction(events as ReceivedEventData[]),
});

app.eventGrid('inventory-eg', {
  handler: (event: unknown, _context: InvocationContext) => handleEventGridEvent(eventGridHost.app, JSON.stringify(event)),
});
