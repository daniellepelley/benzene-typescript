/**
 * One `BenzeneStartUp` per (service, trigger) pair — the TypeScript port of .NET's per-service
 * `StartUp.cs` files, ADAPTED for a TypeScript-specific constraint .NET does not have: C#'s
 * `IMessageTopicGetter<AspNetContext>` and `IMessageTopicGetter<ServiceBusContext>` are different DI
 * service types (generics are not erased), so .NET safely wires every trigger a service listens on into
 * ONE container/app. TypeScript erases that generic parameter — every transport's topic/body/headers
 * getters collapse onto the SAME runtime token (`IMessageTopicGetter<unknown>`), so two transports
 * sharing one container silently clobber each other's registration (confirmed empirically: wiring HTTP +
 * Service Bus into one `AzureFunctionApplicationBuilder` here made the LATER-registered transport's
 * getters answer the EARLIER transport's requests too, throwing on missing fields). This is the exact
 * generic-erasure seam other packages in this port already work around by giving a nested pipeline its
 * own container (see `useBenzeneMessage`'s own doc comment) — and it is exactly why
 * `examples/azure-functions` (this repo's single-domain, three-trigger example) already gives HTTP,
 * Service Bus, and Event Hub each their OWN `BenzeneStartUp` and their OWN `AzureFunctionHost` (a fresh
 * `DefaultBenzeneServiceContainer` per host — see `AzureFunctionStartUpRunner.bootstrap`). This file
 * follows that same, already-proven repo convention: every trigger gets its own startup class and (in
 * `functions/*.ts`) its own `AzureFunctionHost`, never two triggers sharing one.
 *
 * A consequence worth naming: each (service, trigger) pair's `configureServices` runs independently, so
 * the domain handler(s) and outbound routing are registered identically in each of a service's startups
 * via a small shared `configureXServices` helper below — not a real duplication (one function, several
 * callers), just as many small DI containers as a service has triggers.
 */
import { IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { BenzeneStartUp, IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { TransportNames } from '@benzenejs/abstractions-message-handlers';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { addOutboundRouting } from '@benzenejs/clients';
import { addResponseEventDeclarations, ResponseEventDefinition } from '@benzenejs/response-events';
import { useAzureFunctions } from '@benzenejs/azure-function-core';
import { useServiceBus } from '@benzenejs/azure-function-service-bus';
import { useBenzeneMessage, useEventHub } from '@benzenejs/azure-function-event-hub';
import { useEventGrid } from '@benzenejs/azure-function-event-grid';
import { useServiceBus as useServiceBusClient } from '@benzenejs/clients-azure-service-bus';
import { useEventGrid as useEventGridClient } from '@benzenejs/clients-azure-event-grid';
import {
  configureCloudService,
  eventGridPublisher,
  eventHubProducer,
  serviceBusSender,
  wireHttpCloudService,
} from './wiring';
import { useEnvelopeEventHub } from './eventHubEnvelope';
import { OutboundOrderPlaced, OutboundTakePayment, ordersHandlers, ordersHealthChecks } from './domain/orders';
import { OutboundBookShipment, OutboundPaymentCaptured, paymentsHandlers, paymentsHealthChecks, TakePaymentHandler } from './domain/payments';
import { BookShipmentHandler, OutboundShipmentDispatched, shippingHandlers, shippingHealthChecks } from './domain/shipping';
import { inventoryHandlers, inventoryHealthChecks } from './domain/inventory';
import { notificationsHandlers, notificationsHealthChecks } from './domain/notifications';
import { analyticsHandlers, analyticsHealthChecks } from './domain/analytics';

// --- orders: HTTP only inbound; sends payment:take (Service Bus) + order:placed (Event Hub) -----------
// Only one trigger, so only one startup/container is needed.
export class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureCloudService(services, (x) => {
      addResponseEventDeclarations(
        x,
        new ResponseEventDefinition('payment:take', OutboundTakePayment),
        new ResponseEventDefinition('order:placed', OutboundOrderPlaced),
      );
      const paymentsSender = serviceBusSender(process.env['PAYMENTS_QUEUE'] ?? 'payments');
      const orderPlacedProducer = eventHubProducer(process.env['ORDER_PLACED_HUB'] ?? 'order-placed');
      addOutboundRouting(x, (routing) =>
        routing
          .route('payment:take', (p) => useServiceBusClient(p, paymentsSender))
          .route('order:placed', (p) => useEnvelopeEventHub(p, orderPlacedProducer)),
      );
    });
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'orders', ordersHandlers, ordersHealthChecks);
  }
}

// --- payments: HTTP + Service Bus (payment:take); sends shipment:book (Service Bus) + payment:captured (Event Grid) --
function configurePaymentsServices(services: IBenzeneServiceContainer): void {
  configureCloudService(services, (x) => {
    addResponseEventDeclarations(
      x,
      new ResponseEventDefinition('shipment:book', OutboundBookShipment),
      new ResponseEventDefinition('payment:captured', OutboundPaymentCaptured),
    );
    const shippingSender = serviceBusSender(process.env['SHIPPING_QUEUE'] ?? 'shipping');
    const publisher = eventGridPublisher();
    addOutboundRouting(x, (routing) =>
      routing
        .route('shipment:book', (p) => useServiceBusClient(p, shippingSender))
        .route('payment:captured', (p) => useEventGridClient(p, publisher, 'payments-api')),
    );
  });
}

export class PaymentsHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configurePaymentsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'payments', paymentsHandlers, paymentsHealthChecks, [TransportNames.ServiceBus]);
  }
}

export class PaymentsServiceBusStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configurePaymentsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, TakePaymentHandler)));
  }
}

// --- shipping: HTTP + Service Bus (shipment:book); sends shipment:dispatched (Event Grid) --------------
function configureShippingServices(services: IBenzeneServiceContainer): void {
  configureCloudService(services, (x) => {
    addResponseEventDeclarations(x, new ResponseEventDefinition('shipment:dispatched', OutboundShipmentDispatched));
    const publisher = eventGridPublisher();
    addOutboundRouting(x, (routing) =>
      routing.route('shipment:dispatched', (p) => useEventGridClient(p, publisher, 'shipping-api')),
    );
  });
}

export class ShippingHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureShippingServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'shipping', shippingHandlers, shippingHealthChecks, [TransportNames.ServiceBus]);
  }
}

export class ShippingServiceBusStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureShippingServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) => useServiceBus(az, (sb) => useMessageHandlers(sb, BookShipmentHandler)));
  }
}

// --- inventory: HTTP + Event Hub (order:placed) + Event Grid (shipment:dispatched); pure consumer -------
function configureInventoryServices(services: IBenzeneServiceContainer): void {
  configureCloudService(services);
}

export class InventoryHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureInventoryServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'inventory', inventoryHandlers, inventoryHealthChecks, [
      TransportNames.EventHub,
      TransportNames.EventGrid,
    ]);
  }
}

export class InventoryEventHubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureInventoryServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) =>
      useEventHub(az, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, ...inventoryHandlers))),
    );
  }
}

export class InventoryEventGridStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureInventoryServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) => useEventGrid(az, (eg) => useMessageHandlers(eg, ...inventoryHandlers)));
  }
}

// --- notifications: HTTP + Event Hub (order:placed) + Event Grid (payment:captured, shipment:dispatched) --
function configureNotificationsServices(services: IBenzeneServiceContainer): void {
  configureCloudService(services);
}

export class NotificationsHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureNotificationsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'notifications', notificationsHandlers, notificationsHealthChecks, [
      TransportNames.EventHub,
      TransportNames.EventGrid,
    ]);
  }
}

export class NotificationsEventHubStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureNotificationsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) =>
      useEventHub(az, (eh) => useBenzeneMessage(eh, (msg) => useMessageHandlers(msg, ...notificationsHandlers))),
    );
  }
}

export class NotificationsEventGridStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureNotificationsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) => useEventGrid(az, (eg) => useMessageHandlers(eg, ...notificationsHandlers)));
  }
}

// --- analytics: HTTP + Event Grid (payment:captured, shipment:dispatched); pure consumer -----------------
function configureAnalyticsServices(services: IBenzeneServiceContainer): void {
  configureCloudService(services);
}

export class AnalyticsHttpStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureAnalyticsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    wireHttpCloudService(app, 'analytics', analyticsHandlers, analyticsHealthChecks, [TransportNames.EventGrid]);
  }
}

export class AnalyticsEventGridStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    configureAnalyticsServices(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAzureFunctions(app, (az) => useEventGrid(az, (eg) => useMessageHandlers(eg, ...analyticsHandlers)));
  }
}
