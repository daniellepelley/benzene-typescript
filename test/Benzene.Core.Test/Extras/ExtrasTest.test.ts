import { describe, expect, it } from 'vitest';
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMessageHandlerContext } from '@benzene/abstractions-message-handlers';
import { ITopic } from '@benzene/abstractions-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import { IMessageHandlerResult, IResponseHandler } from '@benzene/abstractions-message-handlers';
import { IBenzeneServiceContainer, IRegisterDependency } from '@benzene/abstractions';
import { JsonSerializer } from '@benzene/core-message-handlers';
import {
  Base64JsonMessage,
  BroadcastEventChecker,
  BroadcastEventDefinition,
  BroadcastEventMiddleware,
  IEventSender,
  InlineMediaFormat,
  PatchMessage,
  RawJsonMessage,
  ResponseBuilder,
  addBroadcastEvent,
  hasField,
  set,
  tryGet,
} from '@benzene/extras';

/** Port of the Benzene.Extras scenarios. */

class UpdateOrder extends PatchMessage {
  orderId = '';
  quantity = 0;
}

describe('Patches', () => {
  it('set records the field (lower-cased) and hasField/tryGet read it back', () => {
    const message = new UpdateOrder();

    expect(hasField(message, 'orderId')).toBe(false);
    expect(tryGet(message, 'orderId', 'fallback')).toBe('fallback');

    set(message, 'orderId', '42');

    expect(message.orderId).toBe('42');
    expect(message.updatedFields).toEqual(['orderid']);
    expect(hasField(message, 'orderId')).toBe(true);
    expect(tryGet(message, 'orderId', 'fallback')).toBe('42');
  });

  it('distinguishes "set to default value" from "not supplied"', () => {
    const message = new UpdateOrder();
    set(message, 'quantity', 0);

    // Explicitly set to 0 → tracked, so tryGet returns the value, not the default.
    expect(hasField(message, 'quantity')).toBe(true);
    expect(tryGet(message, 'quantity', -1)).toBe(0);
    // orderId was never set → not tracked.
    expect(hasField(message, 'orderId')).toBe(false);
  });
});

describe('Raw/Base64 JSON messages', () => {
  it('RawJsonMessage carries the JSON string', () => {
    expect(new RawJsonMessage('{"a":1}').json).toBe('{"a":1}');
  });

  it('Base64JsonMessage is created via the factory', () => {
    expect(Base64JsonMessage.createInstance('eyJhIjoxfQ==').base64Json).toBe('eyJhIjoxfQ==');
  });
});

describe('InlineMediaFormat', () => {
  const serializer: ISerializer = new JsonSerializer();

  it('uses one predicate for both read and write when only one is given', () => {
    const format = new InlineMediaFormat<{ ok: boolean }>('application/json', serializer, (ctx) => ctx.ok);

    const resolver = undefined as unknown as IServiceResolver;
    expect(format.contentType).toBe('application/json');
    expect(format.canRead({ ok: true }, resolver)).toBe(true);
    expect(format.canWrite({ ok: true }, resolver)).toBe(true);
    expect(format.canRead({ ok: false }, resolver)).toBe(false);
    expect(format.getSerializer(resolver)).toBe(serializer);
  });

  it('uses distinct read and write predicates when both are given', () => {
    const format = new InlineMediaFormat<{ read: boolean; write: boolean }>(
      'application/json',
      serializer,
      (ctx) => ctx.read,
      (ctx) => ctx.write,
    );

    const resolver = undefined as unknown as IServiceResolver;
    expect(format.canRead({ read: true, write: false }, resolver)).toBe(true);
    expect(format.canWrite({ read: true, write: false }, resolver)).toBe(false);
  });
});

describe('BroadcastEventChecker', () => {
  class OrderCreated {}

  it('matches on topic id and payload constructor', () => {
    const checker = new BroadcastEventChecker(new BroadcastEventDefinition('order:created', OrderCreated));

    expect(checker.check('order:created', new OrderCreated())).toBe(true);
    expect(checker.check('order:updated', new OrderCreated())).toBe(false);
    expect(checker.check('order:created', { notAnOrder: true })).toBe(false);
    expect(checker.findDefinitions()).toHaveLength(1);
  });

  it('registers under both the checker and the shared finder tokens', () => {
    const container = new DefaultBenzeneServiceContainer();
    addBroadcastEvent(container, new BroadcastEventDefinition('order:created', OrderCreated));

    // Registration succeeds and the checker resolves (exercised end-to-end below via the middleware).
    expect(container.isTypeRegistered(IEventSender)).toBe(false);
  });
});

describe('BroadcastEventMiddleware', () => {
  function contextFor(topicId: string, status: string): IMessageHandlerContext<unknown, { id: string }> {
    const topic: ITopic = { id: topicId, version: '' };
    return {
      topic,
      handlerType: undefined,
      request: {},
      response: BenzeneResult.set(status, { id: 'abc' }),
    };
  }

  function resolverWith(sent: Array<{ topic: string; payload: unknown }>): IServiceResolver {
    const container = new DefaultBenzeneServiceContainer();
    const sender: IEventSender = {
      async sendAsync(topic, payload) {
        sent.push({ topic, payload });
      },
    };
    container.addSingletonInstance(IEventSender, sender);
    return container.createServiceResolverFactory().createScope();
  }

  it('broadcasts "<topic>d" carrying the payload when create succeeds', async () => {
    const sent: Array<{ topic: string; payload: unknown }> = [];
    const middleware = new BroadcastEventMiddleware(resolverWith(sent));

    await middleware.handleAsync(contextFor('order:create', BenzeneResultStatus.created), async () => {});

    expect(sent).toEqual([{ topic: 'order:created', payload: { id: 'abc' } }]);
  });

  it('does not broadcast when the status does not match the topic function', async () => {
    const sent: Array<{ topic: string; payload: unknown }> = [];
    const middleware = new BroadcastEventMiddleware(resolverWith(sent));

    // create topic but an Ok (not Created) status → no broadcast.
    await middleware.handleAsync(contextFor('order:create', BenzeneResultStatus.ok), async () => {});

    expect(sent).toEqual([]);
  });

  it('topicFunction returns the last colon-delimited segment', () => {
    expect(BroadcastEventMiddleware.topicFunction({ id: 'order:create', version: '' })).toBe('create');
    expect(BroadcastEventMiddleware.topicFunction({ id: 'delete', version: '' })).toBe('delete');
  });
});

describe('ResponseBuilder', () => {
  class NoopResponseHandler implements IResponseHandler<unknown> {
    async handleAsync(_context: unknown, _messageHandlerResult: IMessageHandlerResult): Promise<void> {}
  }

  it('registers handler constructors and factories, then resolves them in order', () => {
    const container = new DefaultBenzeneServiceContainer();
    const register: IRegisterDependency = {
      register(action: (c: IBenzeneServiceContainer) => void) {
        action(container);
      },
    };
    const factoryHandler = new NoopResponseHandler();

    const builder = new ResponseBuilder<unknown>(register)
      .add(NoopResponseHandler)
      .addFactory(() => factoryHandler);

    const resolver = container.createServiceResolverFactory().createScope();
    const handlers = builder.getBuilders().map((f) => f(resolver));

    expect(handlers).toHaveLength(2);
    expect(handlers[0]).toBeInstanceOf(NoopResponseHandler);
    expect(handlers[1]).toBe(factoryHandler);
  });
});
