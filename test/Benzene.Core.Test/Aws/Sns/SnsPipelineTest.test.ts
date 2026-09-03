import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { BenzeneException } from '@benzenejs/core';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import {
  addSns,
  SnsApplication,
  SnsMessageProcessingException,
  SnsOptions,
  SnsRecordContext,
  useSns,
} from '@benzenejs/aws-lambda-sns';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, messageBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asSns } from '@benzenejs/aws-lambda-testing';

/**
 * End-to-end port of the C# SNS pipeline tests (test/Benzene.Core.Test/Aws/Sns/SnsMessagePipelineTest.cs
 * and SnsFailureHandlingTest.cs): wire the full stack via idiomatic DI and feed realistic SNSEvents
 * through the Lambda entry point / SNS router / message-handler pipeline. SNS is fire-and-forget, so the
 * router writes the `null` "handled" sentinel and the entry point returns it.
 */

class Order {
  orderId: string | undefined;
}

class OrderCreated {
  reference: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('create-order', { registry, requestType: Order, responseType: OrderCreated })
class CreateOrderHandler implements IMessageHandler<Order, OrderCreated> {
  handleAsync(request: Order): Promise<IBenzeneResultOf<OrderCreated>> {
    handled.push(request.orderId ?? '<none>');
    const payload = new OrderCreated();
    payload.reference = `ref-${request.orderId}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

// Migrated off `InlineAwsLambdaStartUp` to the public startup-host harness
// (`benzeneTestHost(StartUp).buildAwsLambdaHost()` + `host.sendEventAsync(...)`) with the `asSns` event
// builder — the exact shape an adopter copies.
class SnsStartUp implements BenzeneStartUp {
  configureServices(services: IBenzeneServiceContainer): void {
    addBenzene(services);
  }

  configure(app: IBenzeneApplicationBuilder): void {
    useAwsLambda(app, (aws) => useSns(aws, (sns) => useMessageHandlers(sns, CreateOrderHandler)));
  }
}

describe('SnsPipeline (via the benzeneTestHost harness)', () => {
  it('routes an SNS record to a decorated handler (fire-and-forget)', async () => {
    handled.length = 0;

    const host = benzeneTestHost(SnsStartUp).buildAwsLambdaHost();

    const response = await host.sendEventAsync(
      asSns(messageBuilder('create-order', { orderId: '42' })),
    );

    // The handler genuinely ran with the deserialized body...
    expect(handled).toEqual(['42']);
    // ...and SNS is fire-and-forget: the router marks the event handled with the null sentinel.
    expect(response).toBeNull();
  });

  it('throws BenzeneException when no router recognizes the event', async () => {
    const host = benzeneTestHost(SnsStartUp).buildAwsLambdaHost();

    await expect(host.sendEventAsync({ foo: 'bar' })).rejects.toThrow(BenzeneException);
  });
});

describe('SnsApplication (direct)', () => {
  it('runs every record through the pipeline in its own scope, recording the message result', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const seenMessages: string[] = [];
    let messageResultSuccessful: boolean | undefined;
    const pipeline = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    pipeline
      .useFn(async (context, next) => {
        seenMessages.push(context.snsRecord.Sns.Message);
        await next();
      })
      .onResponse((context) => {
        messageResultSuccessful = context.messageResult?.isSuccessful;
      });
    useMessageHandlers(pipeline, CreateOrderHandler);

    const application = new SnsApplication(pipeline.build());
    const event = asSns(messageBuilder('create-order', { orderId: '1' }));

    await application.handleAsync(event, container.createServiceResolverFactory());

    expect(seenMessages).toEqual([JSON.stringify({ orderId: '1' })]);
    expect(messageResultSuccessful).toBe(true);
  });

  it('raiseOnFailureStatus throws SnsMessageProcessingException for an unroutable record', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const builder = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new SnsOptions();
    options.raiseOnFailureStatus = true;
    const application = new SnsApplication(builder.build(), options);

    const event = asSns(messageBuilder('no-such-topic', { orderId: '9' }));

    await expect(
      application.handleAsync(event, container.createServiceResolverFactory()),
    ).rejects.toThrow(SnsMessageProcessingException);
  });

  it('SnsOptions defaults: does not catch exceptions, escalates failure results', () => {
    // Safe-by-default (the .NET 1.0 settlement contract): a handler exception cascades
    // (catchExceptions off) and a returned failure result is escalated to a thrown exception so SNS
    // redelivers it (raiseOnFailureStatus on).
    const options = new SnsOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });

  it('raiseOnFailureStatus (default): no result recorded escalates to SnsMessageProcessingException', async () => {
    // Nothing sets a messageResult — typically an unrouted record (no handler matched the topic).
    // Per benzene-dotnet's work/settlement-consistency-fix-plan.md row 1, a null outcome is escalated
    // the same as an explicit failure, not accepted as success — SNS's own subscription retry/redrive
    // is the backstop that makes retaining it safe.
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const builder = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    builder.useFn(async (_context, next) => {
      await next();
    });

    const application = new SnsApplication(builder.build());
    const event = asSns(messageBuilder('create-order', { orderId: '9' }));

    await expect(
      application.handleAsync(event, container.createServiceResolverFactory()),
    ).rejects.toThrow(SnsMessageProcessingException);
  });

  it('raiseOnFailureStatus off: a failure result is accepted (at-most-once opt-out)', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addSns(container);

    const builder = new MiddlewarePipelineBuilder<SnsRecordContext>(container);
    useMessageHandlers(builder, CreateOrderHandler);

    const options = new SnsOptions();
    options.raiseOnFailureStatus = false;
    const application = new SnsApplication(builder.build(), options);

    // Unroutable topic records a failure result, but the opt-out accepts it without throwing.
    const event = asSns(messageBuilder('no-such-topic', { orderId: '9' }));
    await application.handleAsync(event, container.createServiceResolverFactory());
  });
});
