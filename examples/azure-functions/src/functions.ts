/**
 * The three function callbacks the Azure Functions host invokes, one per trigger. Each dispatches its
 * trigger's payload into a Benzene app (built once, at module load) via the transport's `handle*` helper.
 * The idiomatic `app.http(...)`/`app.serviceBusQueue(...)`/`app.eventHub(...)` registrations that bind
 * these to real triggers live in `registrations.ts`.
 */
import { HttpRequest, HttpResponseInit } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import { useMessageHandlers } from '@benzene/core-message-handlers';
import { handleHttpRequest, useAzureHttp } from '@benzene/azure-function-http';
import { handleServiceBusMessages, useServiceBus } from '@benzene/azure-function-service-bus';
import { handleEventHub, useBenzeneMessage, useEventHub } from '@benzene/azure-function-event-hub';
import { azureApp } from './azureApp';
import { NotifyWarehouseHandler, PlaceOrderHandler } from './handlers';

const httpApp = azureApp((app) => useAzureHttp(app, (http) => useMessageHandlers(http, PlaceOrderHandler)));
const serviceBusApp = azureApp((app) =>
  useServiceBus(app, (sb) => useMessageHandlers(sb, NotifyWarehouseHandler)),
);
// Event Hub events carry a serialized BenzeneMessage envelope, so the inner pipeline routes on the
// envelope's own topic via `useBenzeneMessage`.
const eventHubApp = azureApp((app) =>
  useEventHub(app, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, NotifyWarehouseHandler))),
);

/** HTTP trigger (request/response): `POST /orders` returns an order confirmation. */
export function placeOrderHttp(request: HttpRequest): Promise<HttpResponseInit> {
  return handleHttpRequest(httpApp, request);
}

/** Service Bus trigger (batched): each message routes by its `topic` application property. */
export function orderPlacedServiceBus(messages: ServiceBusReceivedMessage[]): Promise<void> {
  return handleServiceBusMessages(serviceBusApp, ...messages);
}

/** Event Hub trigger (batched): each event routes by its embedded topic. */
export function orderPlacedEventHub(events: ReceivedEventData[]): Promise<void> {
  return handleEventHub(eventHubApp, ...events);
}
