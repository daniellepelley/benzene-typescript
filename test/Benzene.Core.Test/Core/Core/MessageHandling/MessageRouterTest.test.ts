import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolver } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IHasMessageResult,
  IMessageGetter,
  IMessageHandler,
  IMessageHandlerContext,
  IMessageHandlerResult,
  IMessageHandlerResultSetter,
  IMessageResult,
  IMessageTopicGetter,
  IRequestMapper,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter, IMessageHeadersGetter, ITopic } from '@benzene/abstractions-messages';
import { IMiddleware, NextFunc } from '@benzene/abstractions-middleware';
import { Topic } from '@benzene/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  DefaultStatuses,
  HandlerPipelineBuilder,
  MessageGetter,
  MessageHandlerDefinitionIndex,
  MessageHandlerDefinitionLookUp,
  MessageHandlerFactory,
  MessageHandlerResult,
  MessageMessageHandlerResultSetterBase,
  MessageRouter,
  MessageRouterBuilder,
  NullMessageHandlerWrapper,
  PipelineMessageHandlerWrapper,
  RegistryMessageHandlersFinder,
  VersionSelector,
  message,
  MessageHandlersRegistry,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/** End-to-end port of the message-routing scenarios exercised across Benzene.Core.Test. */

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

/** A transport context that carries its request body, a topic id, and a pass/fail outcome flag. */
class TestContext implements IHasMessageResult {
  messageResult!: IMessageResult;

  constructor(
    readonly topicId: string | undefined,
    readonly body: unknown,
  ) {}
}

class TestTopicGetter implements IMessageTopicGetter<TestContext> {
  getTopic(context: TestContext): ITopic | undefined {
    return context.topicId === undefined ? undefined : new Topic(context.topicId);
  }
}

class TestBodyGetter implements IMessageBodyGetter<TestContext> {
  getBody(): string | undefined {
    return undefined;
  }
}

class TestHeadersGetter implements IMessageHeadersGetter<TestContext> {
  getHeaders(): Record<string, string> {
    return {};
  }
}

class TestRequestMapper implements IRequestMapper<TestContext> {
  getBody<TRequest>(context: TestContext): TRequest | undefined {
    return context.body as TRequest;
  }
}

/** Captures the full routing outcome so assertions can inspect topic + result. */
class CapturingResultSetter implements IMessageHandlerResultSetter<TestContext> {
  result: IMessageHandlerResult | undefined;

  setResultAsync(context: TestContext, messageHandlerResult: IMessageHandlerResult): Promise<void> {
    this.result = messageHandlerResult;
    context.messageResult = { isSuccessful: messageHandlerResult.benzeneResult.isSuccessful };
    return Promise.resolve();
  }
}

function buildLookUp() {
  const index = new MessageHandlerDefinitionIndex([new RegistryMessageHandlersFinder(registry)]);
  return new MessageHandlerDefinitionLookUp(index, new VersionSelector());
}

function buildMessageGetter(): IMessageGetter<TestContext> {
  return new MessageGetter<TestContext>(
    new TestTopicGetter(),
    new TestBodyGetter(),
    new TestHeadersGetter(),
  );
}

interface Harness {
  router: MessageRouter<TestContext>;
  setter: CapturingResultSetter;
}

function buildRouter(usePipelineWrapper: boolean): Harness {
  const container = new DefaultBenzeneServiceContainer();
  container.addTransient(CreateOrderHandler);
  const resolver = container.createServiceResolverFactory().createScope();

  const wrapper = usePipelineWrapper
    ? new PipelineMessageHandlerWrapper(new HandlerPipelineBuilder([]), resolver)
    : new NullMessageHandlerWrapper();

  const factory = new MessageHandlerFactory(resolver, wrapper, undefined, new DefaultStatuses());
  const setter = new CapturingResultSetter();

  const router = new MessageRouter<TestContext>(
    factory,
    buildMessageGetter(),
    buildLookUp(),
    new TestRequestMapper(),
    setter,
    new DefaultStatuses(),
  );

  return { router, setter };
}

describe('MessageRouterTest', () => {
  it('Route_ResolvesHandlerFromContainerAndProducesResult', async () => {
    const { router, setter } = buildRouter(true);
    const order = new Order();
    order.orderId = '42';

    await router.handleAsync(new TestContext('create-order', order), () => Promise.resolve());

    expect(setter.result).toBeDefined();
    expect(setter.result?.topic?.id).toBe('create-order');
    expect(setter.result?.messageHandlerDefinition?.handlerType).toBe(CreateOrderHandler);
    const result = setter.result!.benzeneResult;
    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.isSuccessful).toBe(true);
    expect((result.payloadAsObject as OrderCreated).reference).toBe('ref-42');
  });

  it('Route_WithNullWrapper_AlsoDispatches', async () => {
    const { router, setter } = buildRouter(false);
    const order = new Order();
    order.orderId = '7';

    await router.handleAsync(new TestContext('create-order', order), () => Promise.resolve());

    expect(setter.result?.benzeneResult.status).toBe(BenzeneResultStatus.ok);
    expect((setter.result?.benzeneResult.payloadAsObject as OrderCreated).reference).toBe('ref-7');
  });

  it('Route_MissingTopic_ShortCircuitsWithValidationError', async () => {
    const { router, setter } = buildRouter(true);

    await router.handleAsync(new TestContext(undefined, new Order()), () => Promise.resolve());

    expect(setter.result?.benzeneResult.status).toBe(BenzeneResultStatus.validationError);
    expect(setter.result?.benzeneResult.isSuccessful).toBe(false);
    expect(setter.result?.benzeneResult.errors).toEqual(['Topic is missing']);
  });

  it('Route_UnknownTopic_ShortCircuitsWithNotFound', async () => {
    const { router, setter } = buildRouter(true);

    await router.handleAsync(new TestContext('does-not-exist', new Order()), () => Promise.resolve());

    expect(setter.result?.benzeneResult.status).toBe(BenzeneResultStatus.notFound);
    expect(setter.result?.benzeneResult.errors).toEqual([
      'No handler found for topic does-not-exist',
    ]);
  });

  it('Route_NeverCallsNext', async () => {
    const { router } = buildRouter(true);
    let nextCalled = false;
    const next: NextFunc = () => {
      nextCalled = true;
      return Promise.resolve();
    };

    await router.handleAsync(new TestContext('create-order', new Order()), next);

    expect(nextCalled).toBe(false);
  });

  it('HandlerMiddleware_CanShortCircuitBeforeHandler', async () => {
    const container = new DefaultBenzeneServiceContainer();
    container.addTransient(CreateOrderHandler);
    const resolver = container.createServiceResolverFactory().createScope();

    // A handler middleware builder that rejects any order without an id before the handler runs.
    const validationBuilder: IHandlerMiddlewareBuilder = {
      create<TRequest, TResponse>(
        _serviceResolver: IServiceResolver,
        _messageHandler: IMessageHandler<TRequest, TResponse>,
      ): IMiddleware<IMessageHandlerContext<TRequest, TResponse>> | undefined {
        return {
          name: 'Validation',
          async handleAsync(
            context: IMessageHandlerContext<TRequest, TResponse>,
            next: NextFunc,
          ): Promise<void> {
            if ((context.request as Order).orderId === undefined) {
              context.response = BenzeneResult.setErrors<TResponse>(
                BenzeneResultStatus.validationError,
                'orderId is required',
              );
              return;
            }
            await next();
          },
        };
      },
    };

    const wrapper = new PipelineMessageHandlerWrapper(
      new HandlerPipelineBuilder([validationBuilder]),
      resolver,
    );
    const factory = new MessageHandlerFactory(resolver, wrapper, undefined, new DefaultStatuses());
    const setter = new CapturingResultSetter();
    const router = new MessageRouter<TestContext>(
      factory,
      buildMessageGetter(),
      buildLookUp(),
      new TestRequestMapper(),
      setter,
      new DefaultStatuses(),
    );

    // Missing orderId -> validation middleware short-circuits, handler never runs.
    await router.handleAsync(new TestContext('create-order', new Order()), () => Promise.resolve());
    expect(setter.result?.benzeneResult.status).toBe(BenzeneResultStatus.validationError);
    expect(setter.result?.benzeneResult.errors).toEqual(['orderId is required']);

    // Present orderId -> passes validation, handler produces the response.
    const order = new Order();
    order.orderId = '99';
    await router.handleAsync(new TestContext('create-order', order), () => Promise.resolve());
    expect(setter.result?.benzeneResult.status).toBe(BenzeneResultStatus.ok);
    expect((setter.result?.benzeneResult.payloadAsObject as OrderCreated).reference).toBe('ref-99');
  });
});

describe('MessageMessageHandlerResultSetterBase', () => {
  class TestResultSetter extends MessageMessageHandlerResultSetterBase<TestContext> {}

  it('SetResult_RecordsSuccessOntoContext', async () => {
    const setter = new TestResultSetter();
    const context = new TestContext('create-order', new Order());

    await setter.setResultAsync(
      context,
      new MessageHandlerResult(undefined, undefined, BenzeneResult.ok()),
    );

    expect(context.messageResult.isSuccessful).toBe(true);
  });

  it('SetResult_RecordsFailureOntoContext', async () => {
    const setter = new TestResultSetter();
    const context = new TestContext('create-order', new Order());

    await setter.setResultAsync(
      context,
      new MessageHandlerResult(
        undefined,
        undefined,
        BenzeneResult.setErrors(BenzeneResultStatus.notFound, 'nope'),
      ),
    );

    expect(context.messageResult.isSuccessful).toBe(false);
  });
});

describe('MessageRouterBuilder', () => {
  it('Add_AccumulatesBuilders_AndRegisterDefers', () => {
    const registrations: unknown[] = [];
    const builder = new MessageRouterBuilder([], (action) => registrations.push(action));

    const middlewareBuilder: IHandlerMiddlewareBuilder = { create: () => undefined };
    const returned = builder.add(middlewareBuilder);

    expect(returned).toBe(builder);
    expect(builder.getBuilders()).toEqual([middlewareBuilder]);

    builder.register(() => {});
    expect(registrations).toHaveLength(1);
  });
});
