import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  ConcurrencyLimiter,
  FixedWindowRateLimiter,
  useFixedWindowRateLimiting,
  usePayloadSizeRateLimiting,
  useRateLimiting,
} from '@benzene/rate-limiting';

/**
 * Port of test/Benzene.Core.Test/Plugins/RateLimiting/RateLimitingPipelineTest.cs. The `TimeSpan` windows
 * become millisecond `number`s (`TimeSpan.FromMinutes(1)` -> `60_000`); the C# `ExampleRequestPayload`
 * becomes a local `Order` handler whose serialized body drives the payload-size cost.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

type ConfigurePipeline = (pipeline: MiddlewarePipelineBuilder<BenzeneMessageContext>) => void;

function createApp(configurePipeline: ConfigurePipeline): {
  app: BenzeneMessageApplication;
  container: DefaultBenzeneServiceContainer;
} {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  configurePipeline(pipeline);
  useMessageHandlers(pipeline, CreateOrderHandler);

  return { app: new BenzeneMessageApplication(pipeline.build()), container };
}

/** Builds a request whose serialized body is `orderIdLength + 14` UTF-8 bytes (`{"orderId":"..."}`). */
function createRequest(orderIdLength = 3): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = 'create-order';
  request.headers = { sender: 'some-sender' };
  request.body = JSON.stringify({ orderId: 'x'.repeat(orderIdLength) });
  return request;
}

async function handle(
  app: BenzeneMessageApplication,
  container: DefaultBenzeneServiceContainer,
  request: BenzeneMessageRequest,
): Promise<{ statusCode: string; body: string }> {
  return app.handleAsync(request, container.createServiceResolverFactory());
}

describe('RateLimitingPipelineTest', () => {
  it('UnderTheLimit_MessagesPassThrough', async () => {
    const { app, container } = createApp((p) => useFixedWindowRateLimiting(p, 10, 60_000));

    const response = await handle(app, container, createRequest());

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
  });

  it('OverTheLimit_ShortCircuitsWithTooManyRequests', async () => {
    const { app, container } = createApp((p) => useFixedWindowRateLimiting(p, 1, 60_000));

    const first = await handle(app, container, createRequest());
    const second = await handle(app, container, createRequest());

    expect(first.statusCode).toBe(BenzeneResultStatus.ok);
    expect(second.statusCode).toBe(BenzeneResultStatus.tooManyRequests);
    expect(second.body).toContain('Rate limit exceeded');
  });

  it('PayloadSizeLimiting_RejectsAPayloadLargerThanTheBucket', async () => {
    // The bucket admits at most 32 bytes at once; this payload alone is far bigger, so it can never be
    // granted - rejected outright rather than erroring.
    const { app, container } = createApp((p) => usePayloadSizeRateLimiting(p, 32, 32, 60_000));

    const response = await handle(app, container, createRequest(200));

    expect(response.statusCode).toBe(BenzeneResultStatus.tooManyRequests);
  });

  it('PayloadSizeLimiting_SpendsTheByteBudget', async () => {
    // Budget covers one 44-byte payload per window but not two: first passes, second rejected.
    const { app, container } = createApp((p) => usePayloadSizeRateLimiting(p, 60, 60, 60_000));

    const first = await handle(app, container, createRequest(30));
    const second = await handle(app, container, createRequest(30));

    expect(first.statusCode).toBe(BenzeneResultStatus.ok);
    expect(second.statusCode).toBe(BenzeneResultStatus.tooManyRequests);
  });

  it('BringYourOwnLimiter_LeaseIsReleasedAfterEachMessage', async () => {
    // A concurrency limiter with a single permit: if the middleware failed to dispose the lease after
    // next(), the second sequential message would be rejected.
    const limiter = new ConcurrencyLimiter({ permitLimit: 1, queueLimit: 0 });
    const { app, container } = createApp((p) => useRateLimiting(p, limiter));

    const first = await handle(app, container, createRequest());
    const second = await handle(app, container, createRequest());

    expect(first.statusCode).toBe(BenzeneResultStatus.ok);
    expect(second.statusCode).toBe(BenzeneResultStatus.ok);
  });

  it('BringYourOwnCost_IsUsedForAcquisition', async () => {
    // Every message costs 5 permits against a 9-permit window: the second must be rejected.
    const limiter = new FixedWindowRateLimiter({
      permitLimit: 9,
      windowMs: 60_000,
      queueLimit: 0,
      autoReplenishment: true,
    });
    const { app, container } = createApp((p) => useRateLimiting(p, limiter, () => 5));

    const first = await handle(app, container, createRequest());
    const second = await handle(app, container, createRequest());

    expect(first.statusCode).toBe(BenzeneResultStatus.ok);
    expect(second.statusCode).toBe(BenzeneResultStatus.tooManyRequests);
  });
});
