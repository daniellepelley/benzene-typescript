/**
 * The shipping-api Function App's registrations: the catch-all HTTP trigger (Cloud Service Profile +
 * `POST /shipments`) plus the Service Bus queue trigger consuming `shipment:book`. TWO separate
 * `AzureFunctionHost`s — see `src/startUps.ts`'s file header for why.
 */
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import '@benzenejs/azure-function-service-bus';
import { ShippingHttpStartUp, ShippingServiceBusStartUp } from '../src/startUps';

const httpHost = new AzureFunctionHost(ShippingHttpStartUp);
const serviceBusHost = new AzureFunctionHost(ShippingServiceBusStartUp);

app.http('shipping-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.serviceBusQueue('shipping-sb', {
  connection: 'ServiceBusConnection',
  queueName: process.env['SHIPPING_QUEUE'] ?? 'shipping',
  cardinality: 'many',
  handler: (messages: unknown, _context: InvocationContext) =>
    serviceBusHost.serviceBusFunction(messages as ServiceBusReceivedMessage[]),
});
