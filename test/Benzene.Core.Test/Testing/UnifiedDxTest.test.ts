import { describe, expect, it } from 'vitest';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { BenzeneTopic, IBenzeneResultOf, IBenzeneServiceContainer, IServiceResolver, serviceToken } from '@benzenejs/abstractions';
import { IMessageHandler, IMessageHandlerContext } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneApplicationBuilder, IMiddleware } from '@benzenejs/abstractions-middleware';
import { BenzeneResult } from '@benzenejs/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { httpEndpoint } from '@benzenejs/http';
import { useAwsLambda, useBenzeneMessage } from '@benzenejs/aws-lambda-core';
import { addApiGateway, ApiGatewayApplication, ApiGatewayContext } from '@benzenejs/aws-lambda-api-gateway';
import {
  benzeneTestHost,
  fakeResolver,
  httpBuilder,
  messageContext,
  testPipeline,
  type BenzeneStartUp,
  type TransportDescriptor,
} from '@benzenejs/testing';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { healthCheck } from '@benzenejs/health-checks';
import { HealthCheckResult, IHealthCheck } from '@benzenejs/health-checks-core';

/**
 * The target developer ergonomics of the test-host unification, proven end-to-end. A service is a
 * non-generic `BenzeneStartUp` whose `configure(app)` reads top-to-bottom like .NET; a test is ~4 lines
 * with no `Parameters<...>[0]`, no six-step construction order, and no `as unknown as`.
 */

class OrderRequest {
  orderId?: string;
}
class OrderResponse {
  reference?: string;
}

// --- Demo 1: a non-generic StartUp + host.sendBenzeneMessageAsync ---------------------------------------

const messageRegistry = new MessageHandlersRegistry();

@message('order:create', { registry: messageRegistry, requestType: OrderRequest, responseType: OrderResponse })
class CreateOrderMessageHandler implements IMessageHandler<OrderRequest, OrderResponse> {
  handleAsync(request: OrderRequest): Promise<IBenzeneResultOf<OrderResponse>> {
    return Promise.resolve(BenzeneResult.ok(Object.assign(new OrderResponse(), { reference: `ref-${request.orderId}` })));
  }
}

class SelfCheck implements IHealthCheck {
  readonly type = 'Self';
  executeAsync() {
    return Promise.resolve(HealthCheckResult.createInstance(true, this.type));
  }
}

/** One non-generic StartUp, transport chosen by the verb, reads as a capability checklist. */
class OrdersStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) =>
      useBenzeneMessage(aws, (bm) => {
        bm.use(healthCheck(BenzeneTopic.healthCheck, [new SelfCheck()]));
        useMessageHandlers(bm, CreateOrderMessageHandler);
      }),
    );
  }
}

// --- Demo 2: a handler exposed over HTTP, driven by testPipeline ---------------------------------------

const httpRegistry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message('orders:create', { registry: httpRegistry, requestType: OrderRequest, responseType: OrderResponse })
class HttpCreateOrderHandler implements IMessageHandler<OrderRequest, OrderResponse> {
  handleAsync(request: OrderRequest): Promise<IBenzeneResultOf<OrderResponse>> {
    return Promise.resolve(BenzeneResult.ok(Object.assign(new OrderResponse(), { reference: `ref-${request.orderId}` })));
  }
}

// --- Demo 3: a single middleware, driven by messageContext + fakeResolver ------------------------------

const IStamp = serviceToken<{ stamp(): string }>('IStamp');

class StampMiddleware implements IMiddleware<IMessageHandlerContext<OrderRequest, OrderResponse>> {
  readonly name = 'Stamp';
  constructor(private readonly resolver: IServiceResolver) {}
  async handleAsync(
    context: IMessageHandlerContext<OrderRequest, OrderResponse>,
    next: () => Promise<void>,
  ): Promise<void> {
    const reference = this.resolver.getService(IStamp).stamp();
    context.response = BenzeneResult.ok(Object.assign(new OrderResponse(), { reference }));
    await next();
  }
}

describe('Unified DX (test-host unification)', () => {
  it('a non-generic StartUp + sendBenzeneMessageAsync reads in ~4 lines', async () => {
    const host = benzeneTestHost(OrdersStartUp).buildAwsLambdaHost();

    const order = await host.sendBenzeneMessageAsync<OrderResponse>('order:create', { orderId: '7' });
    expect(order.reference).toBe('ref-7');

    // The `bm.use(healthCheck(...))` capability answers the reserved healthcheck topic.
    const health = await host.sendBenzeneMessageAsync<{ isHealthy: boolean }>(BenzeneTopic.healthCheck);
    expect(health.isHealthy).toBe(true);
  });

  it('testPipeline collapses the six-step direct-transport construction', async () => {
    const apiGatewayTransport: TransportDescriptor<ApiGatewayContext, APIGatewayProxyEvent, APIGatewayProxyResult> = {
      addServices: (container) => addApiGateway(container),
      createApplication: (pipeline) => new ApiGatewayApplication(pipeline),
    };

    const result = await testPipeline(apiGatewayTransport)
      .configure((builder) => useMessageHandlers(builder, HttpCreateOrderHandler))
      .send(asApiGatewayRequest(httpBuilder('POST', '/orders', { orderId: '7' })) as APIGatewayProxyEvent);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reference).toBe('ref-7');
  });

  it('fakeResolver + messageContext drive one middleware with no `as unknown as`', async () => {
    const resolver = fakeResolver([[IStamp, { stamp: () => 'ref-42' }]]);
    const context = messageContext<OrderRequest, OrderResponse>(
      'order:create',
      Object.assign(new OrderRequest(), { orderId: '42' }),
    );

    await new StampMiddleware(resolver).handleAsync(context, () => Promise.resolve());

    expect(context.response.payload?.reference).toBe('ref-42');
  });
});
