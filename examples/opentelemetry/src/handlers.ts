/**
 * The example's message handlers, written once. They register with a LOCAL registry; `startUp.ts` passes
 * them to `useMessageHandlers` explicitly. Each demonstrates a different trace shape:
 *
 *  - `greeting`     — trivial request/response: just the pipeline's span-per-middleware.
 *  - `order_create` — a deeper trace: a `Payment.Charge` span plus the `Warehouse.*` child spans from the
 *                     injected `IWarehouseService`.
 *  - `order_fail`   — throws inside the handler; the framework catches it and returns a non-success status
 *                     (the app keeps running), and its `Payment.Charge` span is marked as an error span.
 *
 * Ported from the .NET example's `Handlers.cs`. The random `Task.Delay` calls are dropped — they only made
 * the demo's spans visibly wide in a UI and would make the component test slow and non-deterministic.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { withSpan } from './exampleDiagnostics';
import { IWarehouseService } from './warehouseService';

export const registry = new MessageHandlersRegistry();

export class GreetingRequest {
  name = 'world';
}
export class GreetingResponse {
  message = '';
}
export class CreateOrderRequest {
  productId = '';
  quantity = 1;
}
export class OrderReceipt {
  orderId = '';
  productId = '';
  quantity = 0;
  total = 0;
}
export class FailOrderRequest {
  reason = 'card-declined';
}

const UNIT_PRICE = 9.99;

@message('greeting', { registry, requestType: GreetingRequest, responseType: GreetingResponse })
export class GreetingMessageHandler implements IMessageHandler<GreetingRequest, GreetingResponse> {
  handleAsync(request: GreetingRequest): Promise<IBenzeneResultOf<GreetingResponse>> {
    const response = new GreetingResponse();
    response.message = `Hello, ${request.name}!`;
    return Promise.resolve(BenzeneResult.ok(response));
  }
}

@message('order_create', { registry, requestType: CreateOrderRequest, responseType: OrderReceipt })
export class CreateOrderMessageHandler implements IMessageHandler<CreateOrderRequest, OrderReceipt> {
  static readonly inject = [IWarehouseService] as const;
  constructor(private readonly warehouse: IWarehouseService) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<OrderReceipt>> {
    await withSpan('Payment.Charge', async (span) => {
      span.setAttribute('payment.amount', UNIT_PRICE * request.quantity);
    });

    await this.warehouse.dispatchAsync(request.productId, request.quantity);

    const receipt = new OrderReceipt();
    receipt.orderId = Math.random().toString(16).slice(2, 10);
    receipt.productId = request.productId;
    receipt.quantity = request.quantity;
    receipt.total = UNIT_PRICE * request.quantity;
    return BenzeneResult.created(receipt);
  }
}

@message('order_fail', { registry, requestType: FailOrderRequest, responseType: OrderReceipt })
export class FailingOrderMessageHandler implements IMessageHandler<FailOrderRequest, OrderReceipt> {
  handleAsync(request: FailOrderRequest): Promise<IBenzeneResultOf<OrderReceipt>> {
    return withSpan('Payment.Charge', (span) => {
      const error = new Error(`Payment gateway rejected the order: ${request.reason}`);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
      span.recordException(error);
      // The framework catches this and returns a non-success status; the span above is the error span.
      throw error;
    });
  }
}
