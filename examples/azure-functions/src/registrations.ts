/**
 * The idiomatic Azure Functions v4 (isolated-worker) registrations that bind the trigger functions to
 * real triggers - what the Functions host loads. This module is deliberately NOT imported by `index.ts`
 * or the tests (it registers with the `@azure/functions` runtime on import); it typechecks as part of the
 * build and is the copy-paste shape a developer deploys.
 */
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import { orderPlacedEventHub, orderPlacedServiceBus, placeOrderHttp } from './functions';

app.http('placeOrder', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orders',
  handler: (request) => placeOrderHttp(request),
});

app.serviceBusQueue('orderPlacedServiceBus', {
  connection: 'ServiceBusConnection',
  queueName: 'orders',
  cardinality: 'many', // batched: the handler receives an array of messages
  handler: (messages: unknown, _context: InvocationContext) =>
    orderPlacedServiceBus(messages as ServiceBusReceivedMessage[]),
});

app.eventHub('orderPlacedEventHub', {
  connection: 'EventHubConnection',
  eventHubName: 'orders',
  cardinality: 'many',
  handler: (events: unknown, _context: InvocationContext) =>
    orderPlacedEventHub(events as ReceivedEventData[]),
});
