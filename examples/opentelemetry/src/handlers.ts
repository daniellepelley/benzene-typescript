/**
 * The example's message handlers, written once. `register: false` — they record their metadata but join
 * no registry; `startUp.ts` passes them to `useMessageHandlers` explicitly. Each demonstrates a different
 * trace shape:
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
import { message } from '@benzene/core-message-handlers';
import { BenzeneResult } from '@benzene/results';
import { withSpan } from './exampleDiagnostics';
import { IWarehouseService } from './warehouseService';

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

@message('greeting', { register: false, requestType: GreetingRequest, responseType: GreetingResponse })
export class GreetingMessageHandler implements IMessageHandler<GreetingRequest, GreetingResponse> {
  handleAsync(request: GreetingRequest): Promise<IBenzeneResultOf<GreetingResponse>> {
    return Promise.resolve(BenzeneResult.ok<GreetingResponse>({ message: `Hello, ${request.name}!` }));
  }
}

@message('order_create', { register: false, requestType: CreateOrderRequest, responseType: OrderReceipt })
export class CreateOrderMessageHandler implements IMessageHandler<CreateOrderRequest, OrderReceipt> {
  static readonly inject = [IWarehouseService] as const;
  constructor(private readonly warehouse: IWarehouseService) {}

  async handleAsync(request: CreateOrderRequest): Promise<IBenzeneResultOf<OrderReceipt>> {
    await withSpan('Payment.Charge', async (span) => {
      span.setAttribute('payment.amount', UNIT_PRICE * request.quantity);
    });

    await this.warehouse.dispatchAsync(request.productId, request.quantity);

    return BenzeneResult.created<OrderReceipt>({
      orderId: Math.random().toString(16).slice(2, 10),
      productId: request.productId,
      quantity: request.quantity,
      total: UNIT_PRICE * request.quantity,
    });
  }
}

@message('order_fail', { register: false, requestType: FailOrderRequest, responseType: OrderReceipt })
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
