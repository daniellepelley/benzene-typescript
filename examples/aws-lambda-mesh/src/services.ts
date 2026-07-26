/**
 * The six AwsMesh Cloud Services, one Lambda each, mirroring the .NET `examples/AwsMesh` topology:
 *
 *   orders ──payments:capture (SQS)──▶ payments ──shipping:book (SQS)──▶ shipping
 *     │                                    │                                 │
 *     └─order:placed (SNS)─▶ inventory,    ├─payment:captured (EventBridge)─▶ analytics, notifications
 *                            notifications └─────────────────────────────────
 *                                          shipping ─shipment:dispatched (EventBridge)─▶ inventory, notifications, analytics
 *
 * Each service consumes its inbound topics over the transport shown and DECLARES the topics it produces, so
 * the mesh's structural topology (producer of a topic → every consumer of it) renders the full graph.
 */
import { Handler } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler, IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry, useMessageHandlers } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';
import { buildMeshServiceLambda } from './meshService';

/** Cross-service delivery log, so a transport test can assert an event actually reached its consumer. */
export const receipts: string[] = [];
function record(service: string, topic: string, id: string | undefined): void {
  receipts.push(`${service}<-${topic}:${id ?? '?'}`);
}

// --- payloads (each just an id, enough to route and observe) -------------------------------------------
class CreateOrder {
  orderId?: string;
}
class OrderConfirmation {
  orderId?: string;
}
class Message {
  orderId?: string;
}

// --- orders ------------------------------------------------------------------------------------------
const ordersRegistry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('orders:create', { registry: ordersRegistry, requestType: CreateOrder, responseType: OrderConfirmation })
class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderConfirmation> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    record('orders', 'orders:create', request.orderId);
    const confirmation = new OrderConfirmation();
    confirmation.orderId = request.orderId ?? 'order-1';
    // In the full deployment orders would now SEND payments:capture (SQS) + order:placed (SNS); those are
    // declared as produced topics below, which is what drives the mesh topology.
    return Promise.resolve(BenzeneResult.created(confirmation));
  }
}

// --- a tiny event-consumer handler factory (one no-response handler per consumed topic) ---------------
function eventConsumer(service: string, registry: MessageHandlersRegistry, topic: string): void {
  @message(topic, { registry, requestType: Message })
  class ConsumerHandler implements IMessageHandlerNoResponse<Message> {
    handleAsync(request: Message): Promise<void> {
      record(service, topic, request.orderId);
      return Promise.resolve();
    }
  }
  // Reference the class so it isn't tree-shaken; the decorator has already registered it.
  void ConsumerHandler;
}

// --- payments ----------------------------------------------------------------------------------------
const paymentsRegistry = new MessageHandlersRegistry();
eventConsumer('payments', paymentsRegistry, 'payments:capture');

// --- shipping ----------------------------------------------------------------------------------------
const shippingRegistry = new MessageHandlersRegistry();
eventConsumer('shipping', shippingRegistry, 'shipping:book');

// --- inventory ---------------------------------------------------------------------------------------
const inventoryRegistry = new MessageHandlersRegistry();
eventConsumer('inventory', inventoryRegistry, 'order:placed');
eventConsumer('inventory', inventoryRegistry, 'shipment:dispatched');

// --- notifications -----------------------------------------------------------------------------------
const notificationsRegistry = new MessageHandlersRegistry();
eventConsumer('notifications', notificationsRegistry, 'order:placed');
eventConsumer('notifications', notificationsRegistry, 'payment:captured');
eventConsumer('notifications', notificationsRegistry, 'shipment:dispatched');

// --- analytics ---------------------------------------------------------------------------------------
const analyticsRegistry = new MessageHandlersRegistry();
eventConsumer('analytics', analyticsRegistry, 'payment:captured');
eventConsumer('analytics', analyticsRegistry, 'shipment:dispatched');

/**
 * Builds all six service Lambdas, keyed by function name (the name the mesh discovers and invokes).
 * `useMessageHandlers` is imported for its side-effect-free use inside `buildMeshServiceLambda`.
 */
export function buildServiceLambdas(): Record<string, Handler> {
  void useMessageHandlers; // (kept as an explicit dependency marker for the wiring in meshService)
  return {
    'orders-api': buildMeshServiceLambda({
      name: 'orders-api',
      registry: ordersRegistry,
      domainHandlers: [CreateOrderHandler],
      consumes: [{ topic: 'orders:create', transport: 'http', httpMappings: [{ method: 'post', path: '/orders' }] }],
      produces: ['payments:capture', 'order:placed'],
    }),
    'payments-api': buildMeshServiceLambda({
      name: 'payments-api',
      registry: paymentsRegistry,
      domainHandlers: paymentsRegistry.getAll(),
      consumes: [{ topic: 'payments:capture', transport: 'sqs' }],
      produces: ['shipping:book', 'payment:captured'],
      extraTransports: ['http'],
    }),
    'shipping-api': buildMeshServiceLambda({
      name: 'shipping-api',
      registry: shippingRegistry,
      domainHandlers: shippingRegistry.getAll(),
      consumes: [{ topic: 'shipping:book', transport: 'sqs' }],
      produces: ['shipment:dispatched'],
      extraTransports: ['http'],
    }),
    'inventory-api': buildMeshServiceLambda({
      name: 'inventory-api',
      registry: inventoryRegistry,
      domainHandlers: inventoryRegistry.getAll(),
      consumes: [
        { topic: 'order:placed', transport: 'sns' },
        { topic: 'shipment:dispatched', transport: 'eventbridge' },
      ],
      produces: [],
      extraTransports: ['http'],
    }),
    'notifications-api': buildMeshServiceLambda({
      name: 'notifications-api',
      registry: notificationsRegistry,
      domainHandlers: notificationsRegistry.getAll(),
      consumes: [
        { topic: 'order:placed', transport: 'sns' },
        { topic: 'payment:captured', transport: 'eventbridge' },
        { topic: 'shipment:dispatched', transport: 'eventbridge' },
      ],
      produces: [],
      extraTransports: ['http'],
    }),
    'analytics-api': buildMeshServiceLambda({
      name: 'analytics-api',
      registry: analyticsRegistry,
      domainHandlers: analyticsRegistry.getAll(),
      consumes: [
        { topic: 'payment:captured', transport: 'eventbridge' },
        { topic: 'shipment:dispatched', transport: 'eventbridge' },
      ],
      produces: [],
      extraTransports: ['http'],
    }),
  };
}
