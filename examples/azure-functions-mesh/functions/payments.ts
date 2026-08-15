/**
 * The payments-api Function App's registrations: the catch-all HTTP trigger (Cloud Service Profile +
 * `POST /payments`) plus the Service Bus queue trigger consuming `payment:take` (routed by the `topic`
 * application property — see `src/startUps.ts`). TWO separate `AzureFunctionHost`s (one per trigger) —
 * see `src/startUps.ts`'s file header for why one container per trigger is required here.
 */
import { app, InvocationContext } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import { AzureFunctionHost } from '@benzenejs/azure-function-core';
import '@benzenejs/azure-function-http';
import '@benzenejs/azure-function-service-bus';
import { PaymentsHttpStartUp, PaymentsServiceBusStartUp } from '../src/startUps';

const httpHost = new AzureFunctionHost(PaymentsHttpStartUp);
const serviceBusHost = new AzureFunctionHost(PaymentsServiceBusStartUp);

app.http('payments-http', {
  methods: ['GET', 'POST'],
  authLevel: 'anonymous',
  route: '{*route}',
  handler: httpHost.httpFunction,
});

app.serviceBusQueue('payments-sb', {
  connection: 'ServiceBusConnection',
  queueName: process.env['PAYMENTS_QUEUE'] ?? 'payments',
  cardinality: 'many',
  handler: (messages: unknown, _context: InvocationContext) =>
    serviceBusHost.serviceBusFunction(messages as ServiceBusReceivedMessage[]),
});
