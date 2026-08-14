import { handleUnaryCall, Metadata, ServerUnaryCall, status } from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import {
  IMessageHandler,
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzenejs/abstractions-message-handlers';
import { BenzeneException } from '@benzenejs/core';
import { Topic } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  message,
  MessageHandlerDefinition,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import {
  addGrpcMessageHandlers,
  DefaultGrpcStatusCodeMapper,
  GrpcBenzeneError,
  GrpcContext,
  GrpcMessageBodyGetter,
  GrpcMessageHeadersGetter,
  GrpcMessageTopicGetter,
  GrpcMethodDefinition,
  GrpcMethodHandler,
  grpcMethod,
  GrpcRequestMapper,
  GrpcRouteFinder,
  IGrpcMethodFinder,
  IGrpcServerCallAccessor,
  JsonGrpcMessageAdapter,
  ReflectionGrpcMethodFinder,
  useGrpc,
} from '@benzenejs/grpc';
import { createServerUnaryCall } from '@benzenejs/grpc-test-helpers';

/**
 * Vitest port of the core Benzene.Grpc unit + pipeline tests (GrpcMethodHandlerTest,
 * GrpcMethodPipelineTest, GrpcRouteFinderTest, DefaultGrpcStatusCodeMapperTest, GrpcMessageHeadersGetterTest,
 * GrpcRequestMapperTest). Covers the unary bridge end-to-end over a real DI container + decorated
 * @grpcMethod/@message handlers, driving a hand-rolled fake grpc-js ServerUnaryCall through the handler —
 * no live gRPC server/socket, exactly like the other worker tests drive fakes.
 */

// ── Payload types + handlers ────────────────────────────────────────────────────────────────────────

class EchoRequest {
  name = '';
}
class EchoReply {
  message = '';
}
class UploadItem {
  value = 0;
}
class UploadSummary {
  total = 0;
}

// Each test file uses its own registry so decorators don't collide with the global one; handlers are
// passed explicitly to useMessageHandlers regardless.
const registry = new MessageHandlersRegistry();

@grpcMethod('/benzene.test.TestService/Echo')
@message('grpc-test-echo-topic', { registry, requestType: EchoRequest, responseType: EchoReply })
class EchoMessageHandler implements IMessageHandler<EchoRequest, EchoReply> {
  handleAsync(request: EchoRequest): Promise<IBenzeneResultOf<EchoReply>> {
    const reply = new EchoReply();
    reply.message = `Hello ${request.name}`;
    return Promise.resolve(BenzeneResult.ok(reply));
  }
}

// A POCO (non-"wire") reply — proves the JSON/structural adapter pass-through on the response side.
@grpcMethod('/other.package.OtherService/Summarize')
@message('grpc-test-upload-topic', { registry, requestType: UploadItem, responseType: UploadSummary })
class UploadSummaryMessageHandler implements IMessageHandler<UploadItem, UploadSummary> {
  handleAsync(request: UploadItem): Promise<IBenzeneResultOf<UploadSummary>> {
    const summary = new UploadSummary();
    summary.total = request.value * 2;
    return Promise.resolve(BenzeneResult.ok(summary));
  }
}

@grpcMethod('/benzene.test.TestService/Validate')
@message('grpc-test-validation-topic', { registry, requestType: EchoRequest, responseType: EchoReply })
class ValidationFailingMessageHandler implements IMessageHandler<EchoRequest, EchoReply> {
  handleAsync(): Promise<IBenzeneResultOf<EchoReply>> {
    return Promise.resolve(BenzeneResult.validationError('Name is required'));
  }
}

@grpcMethod('/benzene.test.TestService/Accessor')
@message('grpc-test-accessor-topic', { registry, requestType: EchoRequest, responseType: EchoReply })
class AccessorAwareMessageHandler implements IMessageHandler<EchoRequest, EchoReply> {
  static readonly inject = [IGrpcServerCallAccessor] as const;
  constructor(private readonly accessor: IGrpcServerCallAccessor) {}
  handleAsync(): Promise<IBenzeneResultOf<EchoReply>> {
    const reply = new EchoReply();
    reply.message = this.accessor.cancelled ? 'cancelled' : 'not-cancelled';
    return Promise.resolve(BenzeneResult.ok(reply));
  }
}

// The fake grpc-js ServerUnaryCall used throughout is now the shared `@benzenejs/grpc-test-helpers`
// `createServerUnaryCall` (the port of C#'s `TestServerCallContext`), imported above.

async function expectReject<T>(promise: Promise<T>): Promise<GrpcBenzeneError> {
  try {
    await promise;
  } catch (error) {
    return error as GrpcBenzeneError;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}

function buildPipeline(...handlers: Array<new (...args: never[]) => unknown>) {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addGrpcMessageHandlers(container);

  const builder = new MiddlewarePipelineBuilder<GrpcContext>(container);
  useMessageHandlers(builder, ...handlers);
  const pipeline = builder.build();

  return { container, pipeline, serviceResolverFactory: container.createServiceResolverFactory() };
}

// ── DefaultGrpcStatusCodeMapper ──────────────────────────────────────────────────────────────────────

describe('DefaultGrpcStatusCodeMapper', () => {
  const mappings: Array<[string, status]> = [
    [BenzeneResultStatus.ok, status.OK],
    [BenzeneResultStatus.ignored, status.OK],
    [BenzeneResultStatus.created, status.OK],
    [BenzeneResultStatus.accepted, status.OK],
    [BenzeneResultStatus.updated, status.OK],
    [BenzeneResultStatus.deleted, status.OK],
    [BenzeneResultStatus.badRequest, status.INVALID_ARGUMENT],
    [BenzeneResultStatus.validationError, status.INVALID_ARGUMENT],
    [BenzeneResultStatus.unauthorized, status.UNAUTHENTICATED],
    [BenzeneResultStatus.forbidden, status.PERMISSION_DENIED],
    [BenzeneResultStatus.notFound, status.NOT_FOUND],
    [BenzeneResultStatus.conflict, status.ALREADY_EXISTS],
    [BenzeneResultStatus.notImplemented, status.UNIMPLEMENTED],
    [BenzeneResultStatus.serviceUnavailable, status.UNAVAILABLE],
    [BenzeneResultStatus.tooManyRequests, status.RESOURCE_EXHAUSTED],
    [BenzeneResultStatus.timeout, status.DEADLINE_EXCEEDED],
    [BenzeneResultStatus.unexpectedError, status.INTERNAL],
  ];

  it.each(mappings)('maps %s to the right grpc status', (benzeneStatus, expected) => {
    expect(new DefaultGrpcStatusCodeMapper().map(benzeneStatus)).toBe(expected);
  });

  it('defaults undefined to INTERNAL', () => {
    expect(new DefaultGrpcStatusCodeMapper().map(undefined)).toBe(status.INTERNAL);
  });

  it('defaults an unrecognized status to INTERNAL', () => {
    expect(new DefaultGrpcStatusCodeMapper().map('something-unknown')).toBe(status.INTERNAL);
  });
});

// ── GrpcRouteFinder / ReflectionGrpcMethodFinder ─────────────────────────────────────────────────────

describe('GrpcRouteFinder', () => {
  function createRouteFinder(...definitions: GrpcMethodDefinition[]): GrpcRouteFinder {
    const methodFinder: IGrpcMethodFinder = { findDefinitions: () => definitions };
    return new GrpcRouteFinder(methodFinder);
  }

  it('returns the definition on an exact match', () => {
    const a = new GrpcMethodDefinition('/pkg.Service/MethodA', 'topic-a');
    const b = new GrpcMethodDefinition('/pkg.Service/MethodB', 'topic-b');
    expect(createRouteFinder(a, b).find('/pkg.Service/MethodA')).toBe(a);
  });

  it('matches case-insensitively', () => {
    const a = new GrpcMethodDefinition('/pkg.Service/MethodA', 'topic-a');
    expect(createRouteFinder(a).find('/PKG.SERVICE/METHODA')).toBe(a);
  });

  it('returns undefined when nothing matches', () => {
    const a = new GrpcMethodDefinition('/pkg.Service/MethodA', 'topic-a');
    expect(createRouteFinder(a).find('/pkg.Service/Missing')).toBeUndefined();
  });
});

describe('ReflectionGrpcMethodFinder', () => {
  it('binds each @grpcMethod path to the handler topic', () => {
    const localRegistry = new MessageHandlersRegistry();

    @grpcMethod('/pkg.Service/One')
    @message('topic-one', { registry: localRegistry })
    class HandlerOne {}

    const definition: IMessageHandlerDefinition = MessageHandlerDefinition.createInstance(
      'topic-one',
      '',
      HandlerOne,
      HandlerOne,
      HandlerOne,
    );
    const finder = new ReflectionGrpcMethodFinder({ findDefinitions: () => [definition] });

    const [result] = finder.findDefinitions();
    expect(result.method).toBe('/pkg.Service/One');
    expect(result.topic).toBe('topic-one');
  });

  it('throws when two handlers share a gRPC method', () => {
    @grpcMethod('/pkg.Service/Shared')
    class HandlerA {}
    @grpcMethod('/pkg.Service/Shared')
    class HandlerB {}

    const definitionFor = (type: new () => unknown, topic: string): IMessageHandlerDefinition =>
      MessageHandlerDefinition.createInstance(topic, '', type, type, type);

    const messageHandlersFinder: IMessageHandlersFinder = {
      findDefinitions: () => [definitionFor(HandlerA, 'topic-a'), definitionFor(HandlerB, 'topic-b')],
    };

    expect(() => new ReflectionGrpcMethodFinder(messageHandlersFinder).findDefinitions()).toThrow(
      BenzeneException,
    );
  });
});

// ── Getters + request mapper ─────────────────────────────────────────────────────────────────────────

describe('GrpcMessageHeadersGetter', () => {
  it('maps non-binary request headers', () => {
    const metadata = new Metadata();
    metadata.add('x-correlation-id', 'abc-123');
    metadata.add('x-trace-id', 'trace-456');
    const context = new GrpcContext('topic', createServerUnaryCall({ metadata }));

    const headers = new GrpcMessageHeadersGetter().getHeaders(context);
    expect(headers['x-correlation-id']).toBe('abc-123');
    expect(headers['x-trace-id']).toBe('trace-456');
  });

  it('skips binary (-bin) headers', () => {
    const metadata = new Metadata();
    metadata.add('x-plain', 'value');
    metadata.add('x-binary-bin', Buffer.from([1, 2, 3]));
    const context = new GrpcContext('topic', createServerUnaryCall({ metadata }));

    const headers = new GrpcMessageHeadersGetter().getHeaders(context);
    expect(headers['x-plain']).toBe('value');
    expect(headers['x-binary-bin']).toBeUndefined();
  });

  it('keeps the last value on duplicate keys', () => {
    const metadata = new Metadata();
    metadata.add('x-header', 'first');
    metadata.add('x-header', 'second');
    const context = new GrpcContext('topic', createServerUnaryCall({ metadata }));

    expect(new GrpcMessageHeadersGetter().getHeaders(context)['x-header']).toBe('second');
  });
});

describe('GrpcMessageTopicGetter + GrpcMessageBodyGetter', () => {
  it('reads the topic the route finder stored on the context', () => {
    const context = new GrpcContext('my-topic', createServerUnaryCall());
    expect(new GrpcMessageTopicGetter().getTopic(context)).toEqual(new Topic('my-topic'));
  });

  it('serializes the request payload to JSON', () => {
    const request = { name: 'foo' };
    const context = new GrpcContext('topic', createServerUnaryCall({ request }));
    expect(new GrpcMessageBodyGetter().getBody(context)).toBe(JSON.stringify(request));
  });
});

describe('GrpcRequestMapper', () => {
  it('passes the request through the adapter', () => {
    const request = new EchoRequest();
    request.name = 'foo';
    const context = new GrpcContext('topic', createServerUnaryCall({ request }));
    const mapper = new GrpcRequestMapper(new JsonGrpcMessageAdapter());
    expect(mapper.getBody<EchoRequest>(context)).toBe(request);
  });
});

// ── Unary GrpcMethodHandler end-to-end ───────────────────────────────────────────────────────────────

describe('GrpcMethodHandler (unary, end-to-end)', () => {
  it('routes different gRPC services through the shared pipeline', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(
      EchoMessageHandler,
      UploadSummaryMessageHandler,
    );

    const echoHandler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Echo', 'grpc-test-echo-topic'),
      serviceResolverFactory,
      pipeline,
    );
    const uploadHandler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/other.package.OtherService/Summarize', 'grpc-test-upload-topic'),
      serviceResolverFactory,
      pipeline,
    );

    const echo = await echoHandler.handleAsync<EchoReply>(
      createServerUnaryCall({ request: { name: 'world' } }),
    );
    const upload = await uploadHandler.handleAsync<UploadSummary>(
      createServerUnaryCall({ request: { value: 21 } }),
    );

    expect(echo.response.message).toBe('Hello world');
    expect(upload.response.total).toBe(42);
    expect(echo.trailer.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('throws NOT_FOUND (with the benzene-status trailer) when no handler owns the topic', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(EchoMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Missing', 'topic-with-no-handler'),
      serviceResolverFactory,
      pipeline,
    );

    const error = await expectReject(handler.handleAsync<EchoReply>(createServerUnaryCall({ request: { name: 'x' } })));

    expect(error).toBeInstanceOf(GrpcBenzeneError);
    expect(error.code).toBe(status.NOT_FOUND);
    expect(error.metadata?.get('benzene-status')[0]).toBe(BenzeneResultStatus.notFound);
  });

  it('maps a validation-error result to INVALID_ARGUMENT', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(ValidationFailingMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Validate', 'grpc-test-validation-topic'),
      serviceResolverFactory,
      pipeline,
    );

    const error = await expectReject(handler.handleAsync<EchoReply>(createServerUnaryCall({ request: { name: 'x' } })));

    expect(error).toBeInstanceOf(GrpcBenzeneError);
    expect(error.code).toBe(status.INVALID_ARGUMENT);
    expect(error.details).toBe('Name is required');
    expect(error.metadata?.get('benzene-status')[0]).toBe(BenzeneResultStatus.validationError);
  });

  it('lets a handler observe cancellation via IGrpcServerCallAccessor', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(AccessorAwareMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Accessor', 'grpc-test-accessor-topic'),
      serviceResolverFactory,
      pipeline,
    );

    const result = await handler.handleAsync<EchoReply>(
      createServerUnaryCall({ request: { name: 'x' }, cancelled: true }),
    );
    expect(result.response.message).toBe('cancelled');
  });

  it('translates a cancelled call into CANCELLED, or DEADLINE_EXCEEDED past the deadline', async () => {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    addGrpcMessageHandlers(container);
    const builder = new MiddlewarePipelineBuilder<GrpcContext>(container);
    builder.useFn('throw-on-cancel', async (context: GrpcContext, next) => {
      if (context.call.cancelled) {
        throw new Error('boom');
      }
      await next();
    });
    const pipeline = builder.build();
    const serviceResolverFactory = container.createServiceResolverFactory();
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/x/y', 'topic'),
      serviceResolverFactory,
      pipeline,
    );

    const cancelled = await expectReject(
      handler.handleAsync<EchoReply>(createServerUnaryCall({ cancelled: true })),
    );
    expect(cancelled.code).toBe(status.CANCELLED);

    const expired = await expectReject(
      handler.handleAsync<EchoReply>(
        createServerUnaryCall({ cancelled: true, deadline: Date.now() - 1 }),
      ),
    );
    expect(expired.code).toBe(status.DEADLINE_EXCEEDED);
  });
});

// ── useGrpc host bridge ──────────────────────────────────────────────────────────────────────────────

describe('useGrpc bridge', () => {
  function invoke(
    handler: handleUnaryCall<unknown, EchoReply>,
    call: ServerUnaryCall<unknown, EchoReply>,
  ): Promise<{ value?: EchoReply | null; trailer?: Metadata }> {
    return new Promise((resolve, reject) => {
      handler(call, (err, value, trailer) => (err ? reject(err) : resolve({ value, trailer })));
    });
  }

  it('dispatches a unary call through the built pipeline', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoMessageHandler));
    const unary = bridge.toUnaryHandler<unknown, EchoReply>('/benzene.test.TestService/Echo');

    const { value, trailer } = await invoke(
      unary,
      createServerUnaryCall<unknown, EchoReply>({ request: { name: 'world' } }),
    );

    expect(value?.message).toBe('Hello world');
    expect(trailer?.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('resolves the method path from the call when none is pinned', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoMessageHandler));
    const unary = bridge.toUnaryHandler<unknown, EchoReply>();

    const { value } = await invoke(
      unary,
      createServerUnaryCall<unknown, EchoReply>({
        request: { name: 'path' },
        method: '/benzene.test.TestService/Echo',
      }),
    );
    expect(value?.message).toBe('Hello path');
  });

  it('reports UNIMPLEMENTED for a method no Benzene handler owns', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoMessageHandler));
    const unary = bridge.toUnaryHandler<unknown, EchoReply>('/unknown.Service/Nope');

    const error = await expectReject(
      invoke(unary, createServerUnaryCall<unknown, EchoReply>({ request: { name: 'x' } })),
    );

    expect(error).toBeInstanceOf(GrpcBenzeneError);
    expect(error.code).toBe(status.UNIMPLEMENTED);
  });
});
