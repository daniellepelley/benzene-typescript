/**
 * Drives every function in `@benzene-example/azure-functions` end-to-end: build the trigger's native
 * payload and invoke the exported function callback exactly as the Functions host would, asserting the
 * shared handler ran. Proves the "one domain, three triggers" claim - the HTTP function returns a
 * confirmation, and Service Bus + Event Hub deliver to the same warehouse consumer.
 *
 * (`registrations.ts` - the `app.http(...)`/`app.serviceBusQueue(...)`/`app.eventHub(...)` wiring - is
 * intentionally not imported here; it registers with the `@azure/functions` host on load. The callbacks
 * it binds are exactly what this test exercises.)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { HttpRequest } from '@azure/functions';
import type { ServiceBusReceivedMessage } from '@azure/service-bus';
import type { ReceivedEventData } from '@azure/event-hubs';
import {
  orderPlacedEventHub,
  orderPlacedServiceBus,
  placeOrderHttp,
  warehouseNotifications,
} from '@benzene-example/azure-functions';

beforeEach(() => {
  warehouseNotifications.length = 0;
});

function serviceBusMessage(topic: string, payload: unknown): ServiceBusReceivedMessage {
  return {
    messageId: 'message-1',
    body: JSON.stringify(payload),
    applicationProperties: { topic },
  } as unknown as ServiceBusReceivedMessage;
}

// Event Hub carries a serialized BenzeneMessage envelope; the pipeline routes on the envelope's topic.
function eventHubEvent(topic: string, payload: unknown): ReceivedEventData {
  return {
    body: JSON.stringify({ topic, headers: {}, body: JSON.stringify(payload) }),
  } as unknown as ReceivedEventData;
}

describe('@benzene-example/azure-functions', () => {
  it('HTTP: POST /orders returns a 201 confirmation', async () => {
    const request = new HttpRequest({
      method: 'POST',
      url: 'http://localhost/orders',
      headers: { 'content-type': 'application/json' },
      body: { string: JSON.stringify({ customerId: 'acme' }) },
    });

    const response = await placeOrderHttp(request);

    expect(response.status).toBe(201); // BenzeneResult.created -> 201
    expect(JSON.parse(response.body as string)).toEqual({ orderId: 'order-acme' });
  });

  it('Service Bus: each message routes to the warehouse consumer', async () => {
    await orderPlacedServiceBus([
      serviceBusMessage('order:placed', { orderId: 'order-1' }),
      serviceBusMessage('order:placed', { orderId: 'order-2' }),
    ]);

    expect(warehouseNotifications).toEqual(['order-1', 'order-2']);
  });

  it('Event Hub: each event routes to the warehouse consumer', async () => {
    await orderPlacedEventHub([eventHubEvent('order:placed', { orderId: 'order-3' })]);

    expect(warehouseNotifications).toEqual(['order-3']);
  });
});
