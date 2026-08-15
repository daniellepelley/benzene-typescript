/**
 * payments-api's domain: consumes `payment:take` (Service Bus queue, and HTTP for direct calls), then
 * sends `shipment:book` (Service Bus command) and `payment:captured` (Event Grid integration event).
 * Mirrors .NET's `Payments/Domain.cs`.
 */
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IHealthCheck } from '@benzenejs/health-checks-core';
import { message } from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { BenzeneResult } from '@benzenejs/results';
import { IBenzeneMessageSender } from '@benzenejs/clients';
import { selfHealthCheck } from '../wiring';

export class TakePaymentRequest {
  orderId?: string;
  amount?: number;
  currency?: string;
}

export class PaymentTaken {
  paymentId?: string;
  status?: string;
}

/** The command payments-api sends to shipping-api over a Service Bus queue (`shipment:book`). */
export class OutboundBookShipment {
  orderId?: string;
  carrier?: string;
}

/** The integration event payments-api publishes to Event Grid (`payment:captured`). */
export class OutboundPaymentCaptured {
  orderId?: string;
  paymentId?: string;
  amount?: number;
  currency?: string;
}

/** Takes payment (arriving over Service Bus or HTTP), then commands shipping-api and publishes payment:captured. */
@httpEndpoint('POST', '/payments')
@message('payment:take', { register: false, requestType: TakePaymentRequest, responseType: PaymentTaken })
export class TakePaymentHandler implements IMessageHandler<TakePaymentRequest, PaymentTaken> {
  static readonly inject = [IBenzeneMessageSender] as const;
  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: TakePaymentRequest): Promise<IBenzeneResultOf<PaymentTaken>> {
    const payment = new PaymentTaken();
    payment.paymentId = `pay-${request.orderId ?? 'unknown'}`;
    payment.status = 'captured';

    // Best-effort downstream sends (see orders' CreateOrderHandler for why): a missing connection fails
    // the send, caught here, without failing the request.
    try {
      const bookShipment = new OutboundBookShipment();
      bookShipment.orderId = request.orderId;
      bookShipment.carrier = 'DPD';
      await this.sender.sendAsync('shipment:book', bookShipment);
    } catch {
      // best-effort downstream send.
    }

    try {
      const captured = new OutboundPaymentCaptured();
      captured.orderId = request.orderId;
      captured.paymentId = payment.paymentId;
      captured.amount = request.amount;
      captured.currency = request.currency;
      await this.sender.sendAsync('payment:captured', captured);
    } catch {
      // best-effort downstream send.
    }

    return BenzeneResult.created(payment);
  }
}

export const paymentsHandlers = [TakePaymentHandler];
export const paymentsHealthChecks: IHealthCheck[] = [selfHealthCheck('payments')];
