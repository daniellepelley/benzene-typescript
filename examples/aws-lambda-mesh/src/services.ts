/**
 * The six AwsMesh Cloud Services, one Lambda each, mirroring the .NET `examples/AwsMesh` topology:
 *
 *   orders ──payments:capture (SQS)──▶ payments ──shipping:book (SQS)──▶ shipping
 *     │                                    │                                 │
 *     └─order:placed (SNS)─▶ inventory,    ├─payment:captured (EventBridge)─▶ analytics, notifications
 *                            notifications └─ shipping ─shipment:dispatched (EventBridge)─▶ inventory, notifications, analytics
 *
 * Each service consumes its inbound topics over the transport shown, DECLARES the topics it produces (spec
 * `events` → the mesh's structural topology), and — for orders/payments/shipping — actually SENDS them at
 * runtime through the outbound `@benzene/clients-aws-{sqs,sns,eventbridge}` clients onto the in-memory
 * {@link MeshBus}, which delivers to the consuming services. So the same graph shows up both structurally
 * (from the specs) and as a live cascade (a single POST to orders fans all the way through).
 */
import { Handler } from 'aws-lambda';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler, IMessageHandlerNoResponse } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { BenzeneResult } from '@benzene/results';
import { IBenzeneMessageSender } from '@benzene/clients';
import { buildMeshServiceLambda, MeshServiceDefinition, Transport } from './meshService';
import { MeshBus } from './bus';

/** Cross-service delivery log, so a test can assert an event actually reached its consumer. */
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

// --- orders: POST /orders → send payments:capture (SQS) + order:placed (SNS) --------------------------
const ordersRegistry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('orders:create', { registry: ordersRegistry, requestType: CreateOrder, responseType: OrderConfirmation })
class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderConfirmation> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderConfirmation>> {
    record('orders', 'orders:create', request.orderId);
    await this.sender.sendAsync('payments:capture', { orderId: request.orderId }); // SQS command
    await this.sender.sendAsync('order:placed', { orderId: request.orderId }); // SNS fan-out
    const confirmation = new OrderConfirmation();
    confirmation.orderId = request.orderId ?? 'order-1';
    return BenzeneResult.created(confirmation);
  }
}

// --- payments: consume payments:capture → send shipping:book (SQS) + payment:captured (EventBridge) ---
const paymentsRegistry = new MessageHandlersRegistry();

@message('payments:capture', { registry: paymentsRegistry, requestType: Message })
class CapturePaymentHandler implements IMessageHandlerNoResponse<Message> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: Message): Promise<void> {
    record('payments', 'payments:capture', request.orderId);
    await this.sender.sendAsync('shipping:book', { orderId: request.orderId }); // SQS command
    await this.sender.sendAsync('payment:captured', { orderId: request.orderId }); // EventBridge event
  }
}

// --- shipping: consume shipping:book → send shipment:dispatched (EventBridge) --------------------------
const shippingRegistry = new MessageHandlersRegistry();

@message('shipping:book', { registry: shippingRegistry, requestType: Message })
class BookShipmentHandler implements IMessageHandlerNoResponse<Message> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: Message): Promise<void> {
    record('shipping', 'shipping:book', request.orderId);
    await this.sender.sendAsync('shipment:dispatched', { orderId: request.orderId }); // EventBridge event
  }
}

// --- terminal consumers (record only) -----------------------------------------------------------------
function eventConsumer(service: string, registry: MessageHandlersRegistry, topic: string): void {
  @message(topic, { registry, requestType: Message })
  class ConsumerHandler implements IMessageHandlerNoResponse<Message> {
    handleAsync(request: Message): Promise<void> {
      record(service, topic, request.orderId);
      return Promise.resolve();
    }
  }
  void ConsumerHandler; // the decorator has already registered it
}

const inventoryRegistry = new MessageHandlersRegistry();
eventConsumer('inventory', inventoryRegistry, 'order:placed');
eventConsumer('inventory', inventoryRegistry, 'shipment:dispatched');

const notificationsRegistry = new MessageHandlersRegistry();
eventConsumer('notifications', notificationsRegistry, 'order:placed');
eventConsumer('notifications', notificationsRegistry, 'payment:captured');
eventConsumer('notifications', notificationsRegistry, 'shipment:dispatched');

const analyticsRegistry = new MessageHandlersRegistry();
eventConsumer('analytics', analyticsRegistry, 'payment:captured');
eventConsumer('analytics', analyticsRegistry, 'shipment:dispatched');

// --- the estate: each service's definition (topology + which topics it sends, and over what transport) --
// Bus-free and reusable: the in-memory `buildServiceLambdas` and the real per-Lambda deploy entry points
// (`functions/`) both build from these same definitions — only the outbound wiring differs.
export const serviceDefinitions: MeshServiceDefinition[] = [
  {
    name: 'orders-api',
    registry: ordersRegistry,
    domainHandlers: [CreateOrderHandler],
    consumes: [{ topic: 'orders:create', transport: 'http', httpMappings: [{ method: 'post', path: '/orders' }] }],
    produces: ['payments:capture', 'order:placed'],
    sends: [
      { topic: 'payments:capture', transport: 'sqs', targetEnvVar: 'PAYMENTS_QUEUE_URL' },
      { topic: 'order:placed', transport: 'sns', targetEnvVar: 'ORDER_PLACED_TOPIC_ARN' },
    ],
  },
  {
    name: 'payments-api',
    registry: paymentsRegistry,
    domainHandlers: paymentsRegistry.getAll(),
    consumes: [{ topic: 'payments:capture', transport: 'sqs' }],
    produces: ['shipping:book', 'payment:captured'],
    sends: [
      { topic: 'shipping:book', transport: 'sqs', targetEnvVar: 'SHIPPING_QUEUE_URL' },
      { topic: 'payment:captured', transport: 'eventbridge', targetEnvVar: 'EVENT_BUS_NAME' },
    ],
    extraTransports: ['http'],
  },
  {
    name: 'shipping-api',
    registry: shippingRegistry,
    domainHandlers: shippingRegistry.getAll(),
    consumes: [{ topic: 'shipping:book', transport: 'sqs' }],
    produces: ['shipment:dispatched'],
    sends: [{ topic: 'shipment:dispatched', transport: 'eventbridge', targetEnvVar: 'EVENT_BUS_NAME' }],
    extraTransports: ['http'],
  },
  {
    name: 'inventory-api',
    registry: inventoryRegistry,
    domainHandlers: inventoryRegistry.getAll(),
    consumes: [
      { topic: 'order:placed', transport: 'sns' },
      { topic: 'shipment:dispatched', transport: 'eventbridge' },
    ],
    produces: [],
    extraTransports: ['http'],
  },
  {
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
  },
  {
    name: 'analytics-api',
    registry: analyticsRegistry,
    domainHandlers: analyticsRegistry.getAll(),
    consumes: [
      { topic: 'payment:captured', transport: 'eventbridge' },
      { topic: 'shipment:dispatched', transport: 'eventbridge' },
    ],
    produces: [],
    extraTransports: ['http'],
  },
];

/** Looks up a service definition by function name (used by the per-Lambda deploy entry points). */
export function serviceDefinition(name: string): MeshServiceDefinition {
  const def = serviceDefinitions.find((d) => d.name === name);
  if (def === undefined) {
    throw new Error(`Unknown mesh service '${name}'`);
  }
  return def;
}

/**
 * Builds all six service Lambdas, keyed by function name, wired to a shared in-memory {@link MeshBus} so a
 * runtime send genuinely reaches its consumers. The returned map is what the mesh discovers and invokes.
 */
export function buildServiceLambdas(): Record<string, Handler> {
  const bus = new MeshBus();

  // Register every consumed (topic, transport) so the bus can deliver a send to the right services.
  for (const def of serviceDefinitions) {
    for (const consume of def.consumes) {
      if (consume.transport !== 'http') {
        bus.registerConsumer(def.name, consume.topic, consume.transport as Transport);
      }
    }
  }

  const services: Record<string, Handler> = {};
  for (const def of serviceDefinitions) {
    services[def.name] = buildMeshServiceLambda(def, bus.outbound());
  }
  // Late-bind the built handlers so the bus's fake clients can deliver to them.
  Object.assign(bus.services, services);
  return services;
}
