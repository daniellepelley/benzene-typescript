/**
 * The startup-host harness in action — the worked exemplars adopters read (ports of the .NET
 * example `Integration/CreateOrderTest.cs` + `PublishOrderCreatedTest.cs`).
 *
 * This is the gold-standard shape the champion doc defends:
 *
 *   const fake = new FakeBenzeneMessageSender();
 *   const host = benzeneTestHost(OrdersStartUp)          // 1. boot the REAL app from its startup
 *     .withServices((s) => s.addSingletonInstance(IBenzeneMessageSender, fake))  // 2. override ANY registration
 *     .buildAwsLambdaHost();                             // 3. the ONE transport/cloud-specific line
 *   const response = await host.sendEventAsync(asApiGatewayRequest(httpBuilder('POST', '/orders', order)));  // 4/5
 *   expect(response.statusCode).toBe(201);               // 6a. assert on the native response
 *   expect(fake.lastTopic).toBe('order:created');        // 6b. assert on egress
 *
 * To test the SAME handlers on Azure, only line 3 (`buildAwsLambdaHost` → `buildAzureFunctionApp`) and the
 * native-event builder in 4 (`asApiGatewayRequest` → `asAzureHttpRequest`/`asAzureServiceBusMessage`)
 * change. Lines 1, 2, and 6 are identical — the consistency law, proven by the two startups below sharing
 * every handler and an identical `configureServices`, differing only in `configure`.
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { HttpResponseInit } from '@azure/functions';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { httpEndpoint } from '@benzene/http';
import { IBenzeneMessageSender } from '@benzene/clients';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';
import { useAzureHttp } from '@benzene/azure-function-http';
import { useServiceBus } from '@benzene/azure-function-service-bus';
import {
  benzeneTestHost,
  FakeBenzeneMessageSender,
  httpBuilder,
  messageBuilder,
  type BenzeneConfiguration,
} from '@benzene/testing';
import { asApiGatewayRequest, type AwsLambdaStartUp } from '@benzene/aws-lambda-testing';
import {
  asAzureHttpRequest,
  asAzureServiceBusMessage,
  type AzureFunctionStartUp,
} from '@benzene/azure-function-testing';

// ---------------------------------------------------------------------------------------------------
// The shared domain — one set of handlers, hosted on both clouds (the "write once, host anywhere" core).
// ---------------------------------------------------------------------------------------------------

const MessageTopics = {
  createOrder: 'order:create',
  placeOrder: 'order:place',
  orderCreated: 'order:created',
} as const;

class CreateOrder {
  name?: string;
}

class OrderCreatedEvent {
  id?: string;
  name?: string;
}

class OrderDto {
  id?: string;
  name?: string;
}

const registry = new MessageHandlersRegistry();

@httpEndpoint('POST', '/orders')
@message(MessageTopics.createOrder, { registry, requestType: CreateOrder, responseType: OrderDto })
class CreateOrderHandler implements IMessageHandler<CreateOrder, OrderDto> {
  handleAsync(request: CreateOrder): Promise<IBenzeneResultOf<OrderDto>> {
    return Promise.resolve(BenzeneResult.created<OrderDto>({ id: 'order-1', name: request.name }));
  }
}

/**
 * The egress handler: it publishes an `OrderCreatedEvent` on the `order:created` topic through the
 * injected `IBenzeneMessageSender`, then returns Accepted (→ 202). The whole point of the egress demo is
 * that the event handed to the handler is what gets published on the wire.
 */
@httpEndpoint('POST', '/orders/publish-created')
@message(MessageTopics.placeOrder, { registry, requestType: OrderCreatedEvent, responseType: OrderDto })
class PublishOrderCreatedHandler implements IMessageHandler<OrderCreatedEvent, OrderDto> {
  static readonly inject = [IBenzeneMessageSender];

  constructor(private readonly sender: IBenzeneMessageSender) {}

  async handleAsync(request: OrderCreatedEvent): Promise<IBenzeneResultOf<OrderDto>> {
    await this.sender.sendAsync(MessageTopics.orderCreated, request);
    return BenzeneResult.accepted<OrderDto>();
  }
}

/**
 * A real `IBenzeneMessageSender` the startup wires by default. It throws if actually used, proving the
 * `withServices` fake genuinely replaced it (invariant 3: the override reaches any registration).
 */
class ThrowingMessageSender implements IBenzeneMessageSender {
  sendAsync<TRequest, TResponse>(): Promise<IBenzeneResultOf<TResponse>> {
    throw new Error('the real IBenzeneMessageSender was not overridden by the test fake');
  }
}

// The identical service graph both clouds boot — the part a test never has to change between hosts.
function configureSharedServices(services: IBenzeneServiceContainer, _configuration: BenzeneConfiguration): void {
  addBenzene(services);
  services.addSingletonInstance(IBenzeneMessageSender, new ThrowingMessageSender());
}

class AwsOrdersStartUp implements AwsLambdaStartUp {
  configureServices = configureSharedServices;

  configure(app: Parameters<AwsLambdaStartUp['configure']>[0]): void {
    useApiGateway(app, (api) =>
      useMessageHandlers(api, CreateOrderHandler, PublishOrderCreatedHandler),
    );
  }
}

// The HTTP-triggered Azure startup — the direct parallel of AwsOrdersStartUp (both handlers, one
// transport). Its configureServices is byte-identical to AWS's; only `configure` names the transport.
class AzureOrdersStartUp implements AzureFunctionStartUp {
  configureServices = configureSharedServices;

  configure(app: Parameters<AzureFunctionStartUp['configure']>[0]): void {
    useAzureHttp(app, (http) =>
      useMessageHandlers(http, CreateOrderHandler, PublishOrderCreatedHandler),
    );
  }
}

// A Service Bus-triggered startup, to exercise the fire-and-forget send path. Kept to one transport per
// app: the TS port's type-erased DI shares one scoped topic-getter token per container, so — as the
// AzureFunctionApp docs note — a host wires at most one response app and one fire-and-forget app.
class AzureServiceBusOrdersStartUp implements AzureFunctionStartUp {
  configureServices = configureSharedServices;

  configure(app: Parameters<AzureFunctionStartUp['configure']>[0]): void {
    useServiceBus(app, (sb) => useMessageHandlers(sb, PublishOrderCreatedHandler));
  }
}

// ---------------------------------------------------------------------------------------------------
// AWS Lambda — the same setup as Azure below bar the build*Host line and the as* builder name.
// ---------------------------------------------------------------------------------------------------

describe('benzeneTestHost — AWS Lambda', () => {
  it('creates an order via API Gateway and returns 201 with the mapped body', async () => {
    const host = benzeneTestHost(AwsOrdersStartUp).buildAwsLambdaHost();

    const request = asApiGatewayRequest(httpBuilder('POST', '/orders', { name: 'acme' }));
    const response = await host.sendEventAsync<APIGatewayProxyResult>(request);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body)).toMatchObject({ name: 'acme' });
  });

  it('publishes on the order-created topic (ingress → handler → egress), asserting response AND egress', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(AwsOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildAwsLambdaHost();

    const orderCreated: OrderCreatedEvent = { id: 'abc', name: 'acme' };
    const request = asApiGatewayRequest(httpBuilder('POST', '/orders/publish-created', orderCreated));
    const response = await host.sendEventAsync<APIGatewayProxyResult>(request);

    expect(response.statusCode).toBe(202);
    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });
});

// ---------------------------------------------------------------------------------------------------
// Azure Functions — identical lines 1/2/6; only build*Host and the as* builder differ.
// ---------------------------------------------------------------------------------------------------

describe('benzeneTestHost — Azure Functions', () => {
  it('creates an order via HTTP trigger and returns 201 with the mapped body', async () => {
    const host = benzeneTestHost(AzureOrdersStartUp).buildAzureFunctionApp();

    const request = asAzureHttpRequest(httpBuilder('POST', '/orders', { name: 'acme' }));
    const response = await host.sendEventAsync<HttpResponseInit>(request);

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body as string)).toMatchObject({ name: 'acme' });
  });

  it('publishes on the order-created topic via HTTP (ingress → handler → egress), asserting response AND egress', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(AzureOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildAzureFunctionApp();

    const orderCreated: OrderCreatedEvent = { id: 'abc', name: 'acme' };
    const request = asAzureHttpRequest(httpBuilder('POST', '/orders/publish-created', orderCreated));
    const response = await host.sendEventAsync<HttpResponseInit>(request);

    expect(response.status).toBe(202);
    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });

  it('publishes via a Service Bus trigger (fire-and-forget), asserting egress', async () => {
    const fake = new FakeBenzeneMessageSender();

    const host = benzeneTestHost(AzureServiceBusOrdersStartUp)
      .withServices((services) => services.addSingletonInstance(IBenzeneMessageSender, fake))
      .buildAzureFunctionApp();

    const orderCreated: OrderCreatedEvent = { id: 'abc', name: 'acme' };
    await host.sendEventAsync(asAzureServiceBusMessage(messageBuilder(MessageTopics.placeOrder, orderCreated)));

    expect(fake.lastTopic).toBe(MessageTopics.orderCreated);
    expect(fake.lastRequest).toMatchObject({ id: 'abc', name: 'acme' });
  });
});

// ---------------------------------------------------------------------------------------------------
// withConfiguration reaches the startup (invariant 2), the same way on either cloud.
// ---------------------------------------------------------------------------------------------------

describe('benzeneTestHost — configuration override', () => {
  it('threads withConfiguration through to the startup', async () => {
    let seen: string | undefined;

    class ConfiguredStartUp implements AwsLambdaStartUp {
      configureServices(services: IBenzeneServiceContainer, configuration: BenzeneConfiguration): void {
        addBenzene(services);
        seen = configuration.get('greeting');
      }

      configure(app: Parameters<AwsLambdaStartUp['configure']>[0]): void {
        useApiGateway(app, (api) => useMessageHandlers(api, CreateOrderHandler));
      }
    }

    benzeneTestHost(ConfiguredStartUp).withConfiguration('greeting', 'hello').buildAwsLambdaHost();

    expect(seen).toBe('hello');
  });
});
