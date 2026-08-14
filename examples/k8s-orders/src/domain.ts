/**
 * The one piece of business logic this example is about. It is reached three different ways by three
 * different Kubernetes Deployments — `api.ts` maps `POST /orders` straight onto it (the `@httpEndpoint`
 * decorator below), `sqsWorker.ts` polls an SQS queue and dispatches every message to it, and
 * `kafkaWorker.ts` consumes a Kafka topic and dispatches every record to it — all three registering it
 * under the same `@message('order-place')`. Nothing in this class knows which of the three called it: no
 * transport type, no queue/topic name, no HTTP request/response. That's deliberate — it's what "write the
 * handler once, run it behind whichever transport reaches a pod fastest for the traffic you actually
 * have" means in practice, not just as a slogan. See `docs/getting-started-kubernetes.md` for the full
 * walkthrough.
 *
 * The Benzene topic must equal the literal Kafka topic name (no colon-separated topic-id convention on
 * Kafka — see `docs/getting-started-kafka.md`), which is why `order-place` was picked over the
 * colon-style `order:place` this port otherwise favors: Kafka topic names may not contain `:`.
 */
import { randomUUID } from 'node:crypto';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';

export const registry = new MessageHandlersRegistry();

export const PLACE_ORDER_TOPIC = 'order-place';

export class PlaceOrderRequest {
  customerId = '';
  sku = '';
  quantity = 0;
}

export class OrderPlaced {
  orderId = '';
  status = '';
}

@httpEndpoint('POST', '/orders')
@message(PLACE_ORDER_TOPIC, { registry, requestType: PlaceOrderRequest, responseType: OrderPlaced })
export class PlaceOrderHandler implements IMessageHandler<PlaceOrderRequest, OrderPlaced> {
  handleAsync(request: PlaceOrderRequest): Promise<IBenzeneResultOf<OrderPlaced>> {
    const orderId = `order-${randomUUID().replace(/-/g, '').slice(0, 8)}`;

    // The same line, unmodified, is what you'll find in the logs for all three Deployments — proof
    // it's the same code path, not a transport-specific copy of it.
    console.log(
      `order placed: ${orderId} - ${request.quantity}x ${request.sku} for ${request.customerId}`,
    );

    return Promise.resolve(BenzeneResult.created<OrderPlaced>({ orderId, status: 'placed' }));
  }
}
