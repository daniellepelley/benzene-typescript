import { describe, expect, it } from 'vitest';
import { IBenzeneResult, IBenzeneResultOf, IServiceResolver, ServiceIdentifier } from '@benzene/abstractions';
import {
  IHandlerMiddlewareBuilder,
  IMessageHandlerContext,
  IMessageRouterBuilder,
} from '@benzene/abstractions-message-handlers';
import { IMessageDefinition, IMessageDefinitionFinder } from '@benzene/abstractions-messages';
import { Topic } from '@benzene/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  IResponseEventCatalog,
  IResponseEventPublisher,
  PublishFailureMode,
  ResponseEventMappings,
  ResponseEventsBuilder,
  ResponseEventsMiddleware,
  useResponseEvents,
} from '@benzene/response-events';

/**
 * Port of test/Benzene.Core.Test/ResponseEvents/ResponseEventsPipelineTest.cs. The C# test drives the
 * full BenzeneMessage + outbound-routing transport stack; that outbound-routing surface
 * (`AddOutboundRouting`/`IBenzeneMessageSender`) is not yet ported, so the same behaviors are exercised
 * by driving `ResponseEventsMiddleware` directly against a capturing `IResponseEventPublisher` (the
 * publish seam the middleware actually uses).
 */

class OrderPayload {
  id?: number;
  name?: string;
}

/** Records what it was asked to publish and reports success. */
class CapturingPublisher implements IResponseEventPublisher {
  readonly published: { eventTopic: string; payload: unknown }[] = [];
  publishAsync(eventTopic: string, payload: unknown): Promise<IBenzeneResult> {
    this.published.push({ eventTopic, payload });
    return Promise.resolve(BenzeneResult.accepted());
  }
}

/** Always fails the publish (stands in for an unrouted event topic), recording nothing. */
class FailingPublisher implements IResponseEventPublisher {
  publishAsync(): Promise<IBenzeneResult> {
    return Promise.resolve(BenzeneResult.unexpectedError('no route for event topic'));
  }
}

function makeResolver(entries: [unknown, unknown][]): IServiceResolver {
  const map = new Map(entries);
  return {
    getService: <T>(id: ServiceIdentifier<T>): T => {
      if (!map.has(id)) {
        throw new Error('not registered');
      }
      return map.get(id) as T;
    },
    tryGetService: <T>(id: ServiceIdentifier<T>): T | undefined => map.get(id) as T | undefined,
    getServices: <T>(id: ServiceIdentifier<T>): T[] => (map.has(id) ? [map.get(id) as T] : []),
    dispose: () => {},
  };
}

function mappingsOf(configure: (builder: ResponseEventsBuilder) => void): ResponseEventMappings {
  const builder = new ResponseEventsBuilder();
  configure(builder);
  return builder.build();
}

/** Runs the middleware for a handler result and returns the (possibly replaced) response. */
async function runMiddleware(
  mappings: ResponseEventMappings,
  publisher: IResponseEventPublisher,
  handlerResult: IBenzeneResultOf<OrderPayload>,
): Promise<IBenzeneResultOf<OrderPayload>> {
  const resolver = makeResolver([[IResponseEventPublisher, publisher]]);
  const middleware = new ResponseEventsMiddleware<OrderPayload, OrderPayload>(mappings, resolver);
  const context = {
    topic: new Topic('order:create'),
    handlerType: undefined,
    request: new OrderPayload(),
    response: undefined as unknown as IBenzeneResultOf<OrderPayload>,
  } satisfies IMessageHandlerContext<OrderPayload, OrderPayload>;

  await middleware.handleAsync(context, () => {
    context.response = handlerResult;
    return Promise.resolve();
  });

  return context.response;
}

function created(id: number): IBenzeneResultOf<OrderPayload> {
  const payload = new OrderPayload();
  payload.id = id;
  return BenzeneResult.created(payload);
}

describe('ResponseEvents middleware', () => {
  it('map: a successful response publishes the event and keeps the response', async () => {
    const publisher = new CapturingPublisher();
    const response = await runMiddleware(mappingsOf((e) => e.map('order:create', 'order:created')), publisher, created(42));

    expect(response.status).toBe(BenzeneResultStatus.created);
    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]!.eventTopic).toBe('order:created');
    expect((publisher.published[0]!.payload as OrderPayload).id).toBe(42);
  });

  it('map: a failed response does not publish', async () => {
    const publisher = new CapturingPublisher();
    const response = await runMiddleware(
      mappingsOf((e) => e.map('order:create', 'order:created')),
      publisher,
      BenzeneResult.notFound<OrderPayload>(),
    );

    expect(response.status).toBe(BenzeneResultStatus.notFound);
    expect(publisher.published).toHaveLength(0);
  });

  it('map: a successful response without a payload does not publish', async () => {
    const publisher = new CapturingPublisher();
    const response = await runMiddleware(
      mappingsOf((e) => e.map('order:create', 'order:created')),
      publisher,
      BenzeneResult.accepted<OrderPayload>(),
    );

    expect(response.status).toBe(BenzeneResultStatus.accepted);
    expect(publisher.published).toHaveLength(0);
  });

  it('map: a when predicate only publishes when it matches', async () => {
    const configure = (e: ResponseEventsBuilder) =>
      e.map('order:create', 'order:created', (result) => result.status === BenzeneResultStatus.created);

    const onOk = new CapturingPublisher();
    await runMiddleware(mappingsOf(configure), onOk, BenzeneResult.ok(new OrderPayload()));
    expect(onOk.published).toHaveLength(0);

    const onCreated = new CapturingPublisher();
    await runMiddleware(mappingsOf(configure), onCreated, created(1));
    expect(onCreated.published).toHaveLength(1);
  });

  it('mapCrudConvention: a Created result publishes the past-tense topic', async () => {
    const publisher = new CapturingPublisher();
    await runMiddleware(mappingsOf((e) => e.mapCrudConvention()), publisher, created(42));

    expect(publisher.published).toHaveLength(1);
    expect(publisher.published[0]!.eventTopic).toBe('order:created');
  });

  it('mapCrudConvention: an Ok result does not publish', async () => {
    const publisher = new CapturingPublisher();
    await runMiddleware(mappingsOf((e) => e.mapCrudConvention()), publisher, BenzeneResult.ok(new OrderPayload()));

    expect(publisher.published).toHaveLength(0);
  });

  it('an unroutable event topic under FailMessage replaces the response with UnexpectedError', async () => {
    const response = await runMiddleware(mappingsOf((e) => e.map('order:create', 'order:created')), new FailingPublisher(), created(42));

    expect(response.status).toBe(BenzeneResultStatus.unexpectedError);
  });

  it('an unroutable event topic under LogAndContinue keeps the handler response', async () => {
    const response = await runMiddleware(
      mappingsOf((e) => e.map('order:create', 'order:created').onPublishFailure(PublishFailureMode.LogAndContinue)),
      new FailingPublisher(),
      created(42),
    );

    expect(response.status).toBe(BenzeneResultStatus.created);
  });
});

describe('useResponseEvents catalog registration', () => {
  it('registers a catalog that is resolvable and lists the mappings', () => {
    const container = new DefaultBenzeneServiceContainer();
    const builders: IHandlerMiddlewareBuilder[] = [];
    const router: IMessageRouterBuilder = {
      add: (b) => {
        builders.push(b);
        return router;
      },
      getBuilders: () => builders,
      register: (action) => action(container),
    };

    useResponseEvents(router, (e) => e.mapWithPayload(OrderPayload, 'order:create', 'order:created'));

    const resolver = container.createServiceResolverFactory().createScope();
    const catalog = resolver.getService(IResponseEventCatalog);

    expect(catalog.mappings).toHaveLength(1);
    expect(catalog.mappings[0]!.sourceTopic).toBe('order:create');
    expect(catalog.mappings[0]!.eventTopic).toBe('order:created');
    expect(catalog.mappings[0]!.payloadType).toBe(OrderPayload);

    const definitions = (catalog as unknown as IMessageDefinitionFinder<IMessageDefinition>).findDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.topic.id).toBe('order:created');
    expect(definitions[0]!.requestType).toBe(OrderPayload);
  });
});
