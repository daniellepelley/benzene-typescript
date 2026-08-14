import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { CallOptions, Client, Metadata, StatusObject, status } from '@grpc/grpc-js';
import { BenzeneException } from '@benzenejs/core';
import { MiddlewarePipelineBuilder, NullBenzeneServiceContainer } from '@benzenejs/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { IBenzeneMessageClient, sendMessageAsync } from '@benzenejs/clients';
import { JsonGrpcMessageAdapter } from '@benzenejs/grpc';
import { BenzeneResultStatus } from '@benzenejs/results';
import {
  addGrpcClient,
  DefaultGrpcStatusReverseMapper,
  GrpcBenzeneMessageClient,
  GrpcClientMiddleware,
  GrpcClientRouteRegistry,
  GrpcSendMessageContext,
  useGrpcClient,
} from '@benzenejs/grpc-client';

/**
 * Port of the C# Benzene.Grpc.Client tests (DefaultGrpcStatusReverseMapperTest, GrpcClientMiddlewareTest,
 * GrpcBenzeneMessageClientTest). The message client is driven over a FAKE @grpc/grpc-js `Client` (no live
 * gRPC connection): the fake's `makeUnaryRequest` records the call and invokes the callback with either a
 * response (then an OK `status` event, carrying any success trailers) or a `ServiceError` (mirroring
 * grpc-js, which reports a non-OK call through the callback, not by throwing). We assert on the route
 * mapping, the serialized unary request, and the reverse status mapping.
 */

const ECHO_METHOD = '/benzene.test.TestService/Echo';

interface EchoRequest {
  name: string;
}

interface EchoReply {
  message: string;
}

/** What the fake `Client` should do for the next call. */
type FakeBehaviour =
  | { response: unknown; trailers?: Metadata }
  | { error: { code: status; details: string; metadata?: Metadata } };

interface CapturedCall {
  method?: string;
  argument?: unknown;
  requestJson?: string;
  metadata?: Metadata;
  options?: CallOptions;
}

/**
 * A fake @grpc/grpc-js `Client`: its `makeUnaryRequest` records the call and, on the next microtask
 * (so the route can attach its `status` listener first — the real client fires the callback then emits
 * `status`), invokes the callback and emits the `status` event.
 */
function fakeClient(behaviour: FakeBehaviour): { client: Client; captured: CapturedCall } {
  const captured: CapturedCall = {};
  const client = {
    makeUnaryRequest(
      method: string,
      serialize: (value: unknown) => Buffer,
      _deserialize: (value: Buffer) => unknown,
      argument: unknown,
      metadata: Metadata,
      options: CallOptions,
      callback: (error: unknown, value?: unknown) => void,
    ): EventEmitter {
      captured.method = method;
      captured.argument = argument;
      captured.requestJson = serialize(argument).toString('utf8');
      captured.metadata = metadata;
      captured.options = options;

      const emitter = new EventEmitter();
      queueMicrotask(() => {
        if ('error' in behaviour) {
          const metadataTrailers = behaviour.error.metadata ?? new Metadata();
          const err = Object.assign(new Error(behaviour.error.details), {
            code: behaviour.error.code,
            details: behaviour.error.details,
            metadata: metadataTrailers,
          });
          callback(err);
          const statusObject: StatusObject = {
            code: behaviour.error.code,
            details: behaviour.error.details,
            metadata: metadataTrailers,
          };
          emitter.emit('status', statusObject);
        } else {
          callback(null, behaviour.response);
          const statusObject: StatusObject = {
            code: status.OK,
            details: '',
            metadata: behaviour.trailers ?? new Metadata(),
          };
          emitter.emit('status', statusObject);
        }
      });
      return emitter;
    },
  } as unknown as Client;

  return { client, captured };
}

function benzeneStatusTrailer(value: string): Metadata {
  const metadata = new Metadata();
  metadata.add('benzene-status', value);
  return metadata;
}

describe('DefaultGrpcStatusReverseMapper', () => {
  const cases: [status, string][] = [
    [status.OK, BenzeneResultStatus.ok],
    [status.INVALID_ARGUMENT, BenzeneResultStatus.badRequest],
    [status.UNAUTHENTICATED, BenzeneResultStatus.unauthorized],
    [status.PERMISSION_DENIED, BenzeneResultStatus.forbidden],
    [status.NOT_FOUND, BenzeneResultStatus.notFound],
    [status.ALREADY_EXISTS, BenzeneResultStatus.conflict],
    [status.UNIMPLEMENTED, BenzeneResultStatus.notImplemented],
    [status.UNAVAILABLE, BenzeneResultStatus.serviceUnavailable],
    [status.RESOURCE_EXHAUSTED, BenzeneResultStatus.tooManyRequests],
    [status.DEADLINE_EXCEEDED, BenzeneResultStatus.timeout],
    [status.CANCELLED, BenzeneResultStatus.serviceUnavailable],
  ];

  it.each(cases)('maps status %d to the Benzene status', (code, expected) => {
    const mapper = new DefaultGrpcStatusReverseMapper();
    expect(mapper.map(code, undefined)).toBe(expected);
  });

  it('returns unexpectedError for an unrecognized status code', () => {
    const mapper = new DefaultGrpcStatusReverseMapper();
    expect(mapper.map(status.DATA_LOSS, undefined)).toBe(BenzeneResultStatus.unexpectedError);
  });

  it('prefers a benzene-status trailer over the status-code mapping', () => {
    const mapper = new DefaultGrpcStatusReverseMapper();
    expect(mapper.map(status.OK, benzeneStatusTrailer('created'))).toBe('created');
  });

  it('falls back to the status-code mapping when trailers lack the benzene-status key', () => {
    const mapper = new DefaultGrpcStatusReverseMapper();
    const trailers = new Metadata();
    trailers.add('other-key', 'value');
    expect(mapper.map(status.NOT_FOUND, trailers)).toBe(BenzeneResultStatus.notFound);
  });
});

describe('GrpcClientRouteRegistry', () => {
  it('maps a topic to a route and returns undefined for an unregistered topic', () => {
    const registry = new GrpcClientRouteRegistry();
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);

    expect(registry.find('echo-topic')).toBeDefined();
    expect(registry.find('unregistered-topic')).toBeUndefined();
  });

  it('throws for a full method name without a service/method separator', () => {
    const registry = new GrpcClientRouteRegistry();
    expect(() => registry.add('bad', 'not-a-valid-method')).toThrow(BenzeneException);
  });
});

describe('GrpcClientMiddleware', () => {
  it('invokes the registered route with the request, method and headers', async () => {
    const { client, captured } = fakeClient({ response: { message: 'hello' } });
    const registry = new GrpcClientRouteRegistry();
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);
    const middleware = new GrpcClientMiddleware(client, registry, new JsonGrpcMessageAdapter());
    const headers = new Metadata();
    headers.add('x-correlation-id', 'abc-123');
    const context = new GrpcSendMessageContext('echo-topic', { name: 'world' }, headers);

    await middleware.handleAsync(context, () => Promise.resolve());

    expect(captured.method).toBe(ECHO_METHOD);
    expect(captured.requestJson).toBe(JSON.stringify({ name: 'world' }));
    expect(captured.metadata?.get('x-correlation-id')).toEqual(['abc-123']);
    expect((context.response as EchoReply).message).toBe('hello');
    expect(context.status.code).toBe(status.OK);
  });

  it('sets UNIMPLEMENTED without calling the client when no route is registered', async () => {
    const { client, captured } = fakeClient({ response: {} });
    const middleware = new GrpcClientMiddleware(client, new GrpcClientRouteRegistry(), new JsonGrpcMessageAdapter());
    const context = new GrpcSendMessageContext('unregistered-topic', { name: 'world' }, new Metadata());

    await middleware.handleAsync(context, () => Promise.resolve());

    expect(context.status.code).toBe(status.UNIMPLEMENTED);
    expect(captured.method).toBeUndefined();
  });

  it('captures a call error status and trailers without rethrowing', async () => {
    const trailers = benzeneStatusTrailer('not-found');
    const { client } = fakeClient({ error: { code: status.NOT_FOUND, details: 'missing', metadata: trailers } });
    const registry = new GrpcClientRouteRegistry();
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);
    const middleware = new GrpcClientMiddleware(client, registry, new JsonGrpcMessageAdapter());
    const context = new GrpcSendMessageContext('echo-topic', { name: 'world' }, new Metadata());

    await middleware.handleAsync(context, () => Promise.resolve());

    expect(context.status.code).toBe(status.NOT_FOUND);
    expect(context.responseTrailers?.get('benzene-status')).toEqual(['not-found']);
  });
});

describe('GrpcBenzeneMessageClient', () => {
  function buildClient(behaviour: FakeBehaviour): {
    client: GrpcBenzeneMessageClient;
    registry: GrpcClientRouteRegistry;
    captured: CapturedCall;
  } {
    const { client: grpcClient, captured } = fakeClient(behaviour);
    const registry = new GrpcClientRouteRegistry();
    return { client: new GrpcBenzeneMessageClient(grpcClient, registry), registry, captured };
  }

  it('returns the mapped Ok response when the call succeeds', async () => {
    const { client, registry, captured } = buildClient({ response: { message: 'hello' } });
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' });

    expect(result.isSuccessful).toBe(true);
    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(result.payload.message).toBe('hello');
    expect(captured.method).toBe(ECHO_METHOD);
    expect(captured.requestJson).toBe(JSON.stringify({ name: 'world' }));
  });

  it('returns the mapped error status when the call fails', async () => {
    const { client, registry } = buildClient({ error: { code: status.NOT_FOUND, details: 'no such thing' } });
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' });

    expect(result.isSuccessful).toBe(false);
    expect(result.status).toBe(BenzeneResultStatus.notFound);
    expect(result.errors).toContain('no such thing');
  });

  it('returns NotImplemented when no route is registered', async () => {
    const { client } = buildClient({ response: {} });

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'unregistered-topic', { name: 'world' });

    expect(result.isSuccessful).toBe(false);
    expect(result.status).toBe(BenzeneResultStatus.notImplemented);
  });

  it('recovers a benzene-status trailer verbatim on an OK call (created vs accepted)', async () => {
    const { client, registry } = buildClient({ response: { message: 'made' }, trailers: benzeneStatusTrailer('created') });
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' });

    expect(result.status).toBe('created');
    expect(result.payload.message).toBe('made');
  });

  it('forwards the per-call headers as gRPC metadata', async () => {
    const { client, registry, captured } = buildClient({ response: { message: 'hi' } });
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);

    await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' }, { 'correlation-id': 'xyz-1' });

    expect(captured.metadata?.get('correlation-id')).toEqual(['xyz-1']);
  });

  it('works over a prebuilt pipeline (the testing constructor)', async () => {
    const { client: grpcClient } = fakeClient({ response: { message: 'hello' } });
    const registry = new GrpcClientRouteRegistry();
    registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);
    const pipeline = useGrpcClient(
      new MiddlewarePipelineBuilder<GrpcSendMessageContext>(new NullBenzeneServiceContainer()),
      grpcClient,
      registry,
      new JsonGrpcMessageAdapter(),
    ).build();
    const client = new GrpcBenzeneMessageClient(pipeline);

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' });

    expect(result.status).toBe(BenzeneResultStatus.ok);
  });
});

describe('addGrpcClient (DI wiring)', () => {
  it('registers a resolvable IBenzeneMessageClient that routes to the configured method', async () => {
    const { client: grpcClient, captured } = fakeClient({ response: { message: 'hello' } });
    const container = new DefaultBenzeneServiceContainer();
    addGrpcClient(container, grpcClient, (registry) => {
      registry.add<EchoRequest, EchoReply>('echo-topic', ECHO_METHOD);
    });

    const resolver = container.createServiceResolverFactory().createScope();
    const client = resolver.getService(IBenzeneMessageClient);

    const result = await sendMessageAsync<EchoRequest, EchoReply>(client, 'echo-topic', { name: 'world' });

    expect(result.status).toBe(BenzeneResultStatus.ok);
    expect(captured.method).toBe(ECHO_METHOD);
    resolver.dispose();
  });
});
