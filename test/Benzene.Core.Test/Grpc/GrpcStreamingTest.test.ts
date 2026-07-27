import { EventEmitter } from 'node:events';
import {
  handleBidiStreamingCall,
  handleClientStreamingCall,
  handleServerStreamingCall,
  Metadata,
  ServerDuplexStream,
  ServerReadableStream,
  ServerWritableStream,
  status,
} from '@grpc/grpc-js';
import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  addGrpcMessageHandlers,
  convertStream,
  GrpcBenzeneError,
  GrpcContext,
  GrpcMethodDefinition,
  GrpcMethodHandler,
  grpcMethod,
  GrpcRequestMapper,
  isAsyncIterable,
  JsonGrpcMessageAdapter,
  readAll,
  useGrpc,
} from '@benzene/grpc';

/**
 * Vitest port of the C# Benzene.Grpc streaming tests (GrpcMethodHandlerStreamingTest +
 * GrpcStreamingHostingTest), covering the three non-unary server-side shapes — server-streaming,
 * client-streaming, and bidirectional — end-to-end over a real DI container + decorated
 * @grpcMethod/@message handlers. As with the unary GrpcTest, the grpc-js streaming calls are hand-rolled
 * fakes (a writable that records written items, a readable that yields a fixed request sequence, a duplex
 * that does both) — no live gRPC server/socket. The .NET `IServerStreamWriter<T>`/`IAsyncStreamReader<T>`
 * map to grpc-js `ServerWritableStream`/`ServerReadableStream`/`ServerDuplexStream`; `IAsyncEnumerable<T>`
 * maps to `AsyncIterable<T>`.
 */

// ── Payload types ────────────────────────────────────────────────────────────────────────────────────

class SubscribeRequest {
  topic = '';
}
class SubscribeReply {
  item = '';
}
class UploadItem {
  value = 0;
}
class UploadSummary {
  total = 0;
}
class ChatMessage {
  text = '';
}

const registry = new MessageHandlersRegistry();

// ── Handlers (streaming) ─────────────────────────────────────────────────────────────────────────────

// Server-streaming: one request in, a stream of responses out.
@grpcMethod('/benzene.test.TestService/Subscribe')
@message('grpc-test-subscribe-topic', { registry, requestType: SubscribeRequest })
class SubscribeMessageHandler
  implements IMessageHandler<SubscribeRequest, AsyncIterable<SubscribeReply>>
{
  handleAsync(request: SubscribeRequest): Promise<IBenzeneResultOf<AsyncIterable<SubscribeReply>>> {
    return Promise.resolve(BenzeneResult.ok(produce(request.topic)));
  }
}

async function* produce(topic: string): AsyncIterable<SubscribeReply> {
  for (let i = 0; i < 3; i++) {
    const reply = new SubscribeReply();
    reply.item = `${topic}-${i}`;
    yield reply;
  }
}

// Client-streaming: a stream of requests in, one response out.
@grpcMethod('/benzene.test.TestService/Upload')
@message('grpc-test-upload-stream-topic', { registry })
class UploadStreamMessageHandler
  implements IMessageHandler<AsyncIterable<UploadItem>, UploadSummary>
{
  async handleAsync(request: AsyncIterable<UploadItem>): Promise<IBenzeneResultOf<UploadSummary>> {
    let total = 0;
    for await (const item of request) {
      total += item.value;
    }
    const summary = new UploadSummary();
    summary.total = total;
    return BenzeneResult.ok(summary);
  }
}

// Bidirectional: a stream of requests in, a stream of responses out.
@grpcMethod('/benzene.test.TestService/Chat')
@message('grpc-test-chat-topic', { registry })
class ChatMessageHandler
  implements IMessageHandler<AsyncIterable<ChatMessage>, AsyncIterable<ChatMessage>>
{
  handleAsync(
    request: AsyncIterable<ChatMessage>,
  ): Promise<IBenzeneResultOf<AsyncIterable<ChatMessage>>> {
    return Promise.resolve(BenzeneResult.ok(echo(request)));
  }
}

async function* echo(source: AsyncIterable<ChatMessage>): AsyncIterable<ChatMessage> {
  for await (const incoming of source) {
    const outgoing = new ChatMessage();
    outgoing.text = `Echo: ${incoming.text}`;
    yield outgoing;
  }
}

// A middleware that throws when the call is cancelled — the port's analog of the C# cancelling pipeline
// (`context.CancellationToken.ThrowIfCancellationRequested()`).
function buildCancellingPipeline() {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addGrpcMessageHandlers(container);
  const builder = new MiddlewarePipelineBuilder<GrpcContext>(container);
  builder.useFn('throw-on-cancel', async (context: GrpcContext, next) => {
    if (context.call.cancelled) {
      throw new Error('cancelled');
    }
    await next();
  });
  return { pipeline: builder.build(), serviceResolverFactory: container.createServiceResolverFactory() };
}

function buildPipeline(...handlers: Array<new (...args: never[]) => unknown>) {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addGrpcMessageHandlers(container);
  const builder = new MiddlewarePipelineBuilder<GrpcContext>(container);
  useMessageHandlers(builder, ...handlers);
  return { pipeline: builder.build(), serviceResolverFactory: container.createServiceResolverFactory() };
}

// ── Fake grpc-js streaming calls ─────────────────────────────────────────────────────────────────────

interface FakeStreamOptions {
  request?: unknown;
  metadata?: Metadata;
  method?: string;
  cancelled?: boolean;
  deadline?: number | Date;
}

/** A fake ServerWritableStream (server-streaming) that records every written response + the end trailer. */
class FakeServerWritableStream<TRes> extends EventEmitter {
  readonly written: TRes[] = [];
  endTrailer?: Metadata;
  ended = false;
  readonly whenEnded: Promise<void>;
  private resolveEnded!: () => void;

  constructor(private readonly options: FakeStreamOptions = {}) {
    super();
    this.whenEnded = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
  }

  get request(): unknown {
    return this.options.request;
  }
  get metadata(): Metadata {
    return this.options.metadata ?? new Metadata();
  }
  get cancelled(): boolean {
    return this.options.cancelled ?? false;
  }
  getDeadline(): number | Date {
    return this.options.deadline ?? Infinity;
  }
  getPath(): string {
    return this.options.method ?? '/benzene.test.TestService/Subscribe';
  }
  write(item: TRes): boolean {
    this.written.push(item);
    return true;
  }
  end(trailer?: Metadata): this {
    this.ended = true;
    this.endTrailer = trailer;
    this.resolveEnded();
    return this;
  }
}

/** A fake ServerReadableStream (client-streaming) that yields a fixed sequence of requests. */
class FakeServerReadableStream<TReq> extends EventEmitter {
  constructor(
    private readonly items: TReq[],
    private readonly options: FakeStreamOptions = {},
  ) {
    super();
  }

  get metadata(): Metadata {
    return this.options.metadata ?? new Metadata();
  }
  get cancelled(): boolean {
    return this.options.cancelled ?? false;
  }
  getDeadline(): number | Date {
    return this.options.deadline ?? Infinity;
  }
  getPath(): string {
    return this.options.method ?? '/benzene.test.TestService/Upload';
  }
  async *[Symbol.asyncIterator](): AsyncIterator<TReq> {
    for (const item of this.items) {
      yield item;
    }
  }
}

/** A fake ServerDuplexStream (bidi) that both yields a fixed request sequence and records writes. */
class FakeServerDuplexStream<TReq, TRes> extends EventEmitter {
  readonly written: TRes[] = [];
  endTrailer?: Metadata;
  ended = false;
  readonly whenEnded: Promise<void>;
  private resolveEnded!: () => void;

  constructor(
    private readonly items: TReq[],
    private readonly options: FakeStreamOptions = {},
  ) {
    super();
    this.whenEnded = new Promise((resolve) => {
      this.resolveEnded = resolve;
    });
  }

  get metadata(): Metadata {
    return this.options.metadata ?? new Metadata();
  }
  get cancelled(): boolean {
    return this.options.cancelled ?? false;
  }
  getDeadline(): number | Date {
    return this.options.deadline ?? Infinity;
  }
  getPath(): string {
    return this.options.method ?? '/benzene.test.TestService/Chat';
  }
  async *[Symbol.asyncIterator](): AsyncIterator<TReq> {
    for (const item of this.items) {
      yield item;
    }
  }
  write(item: TRes): boolean {
    this.written.push(item);
    return true;
  }
  end(trailer?: Metadata): this {
    this.ended = true;
    this.endTrailer = trailer;
    this.resolveEnded();
    return this;
  }
}

function asWritable<TRes>(fake: FakeServerWritableStream<TRes>): ServerWritableStream<unknown, TRes> {
  return fake as unknown as ServerWritableStream<unknown, TRes>;
}
function asReadable<TReq>(fake: FakeServerReadableStream<TReq>): ServerReadableStream<TReq, unknown> {
  return fake as unknown as ServerReadableStream<TReq, unknown>;
}
function asDuplex<TReq, TRes>(
  fake: FakeServerDuplexStream<TReq, TRes>,
): ServerDuplexStream<TReq, TRes> {
  return fake as unknown as ServerDuplexStream<TReq, TRes>;
}

async function expectReject<T>(promise: Promise<T>): Promise<GrpcBenzeneError> {
  try {
    await promise;
  } catch (error) {
    return error as GrpcBenzeneError;
  }
  throw new Error('Expected the call to reject, but it resolved.');
}

// ── GrpcStreamAdapter helpers ────────────────────────────────────────────────────────────────────────

describe('GrpcStreamAdapter', () => {
  it('isAsyncIterable recognizes async iterables and rejects plain values', () => {
    expect(isAsyncIterable(new FakeServerReadableStream([1, 2]))).toBe(true);
    expect(isAsyncIterable((async function* () {})())).toBe(true);
    expect(isAsyncIterable({ a: 1 })).toBe(false);
    expect(isAsyncIterable([1, 2])).toBe(false);
    expect(isAsyncIterable(undefined)).toBe(false);
    expect(isAsyncIterable(null)).toBe(false);
  });

  it('readAll re-yields every item of the inbound stream', async () => {
    const source = new FakeServerReadableStream([{ value: 1 }, { value: 2 }]);
    const collected: unknown[] = [];
    for await (const item of readAll(source)) {
      collected.push(item);
    }
    expect(collected).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it('convertStream maps each item through the adapter (structural pass-through)', async () => {
    const adapter = new JsonGrpcMessageAdapter();
    const source = (async function* () {
      yield { a: 1 };
      yield { a: 2 };
    })();
    const collected: unknown[] = [];
    for await (const item of convertStream(source, adapter, true)) {
      collected.push(item);
    }
    expect(collected).toEqual([{ a: 1 }, { a: 2 }]);
  });
});

// ── GrpcRequestMapper: the streaming request branch ──────────────────────────────────────────────────

describe('GrpcRequestMapper (streaming request)', () => {
  it('wraps an async-iterable request as a converting stream', async () => {
    const items = new FakeServerReadableStream([{ value: 1 }, { value: 2 }]);
    const context = new GrpcContext('topic', asReadable(items), readAll(items));
    const mapper = new GrpcRequestMapper(new JsonGrpcMessageAdapter());

    const stream = mapper.getBody<AsyncIterable<UploadItem>>(context);
    expect(stream).toBeDefined();
    expect(isAsyncIterable(stream)).toBe(true);

    const collected: unknown[] = [];
    for await (const item of stream!) {
      collected.push(item);
    }
    expect(collected).toEqual([{ value: 1 }, { value: 2 }]);
  });
});

// ── Server-streaming ─────────────────────────────────────────────────────────────────────────────────

describe('GrpcMethodHandler.serverStreamingAsync', () => {
  it('writes every item the handler yields', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(SubscribeMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Subscribe', 'grpc-test-subscribe-topic'),
      serviceResolverFactory,
      pipeline,
    );
    const writer = new FakeServerWritableStream<SubscribeReply>({ request: { topic: 't' } });

    const trailer = await handler.serverStreamingAsync<SubscribeReply>(asWritable(writer));

    expect(writer.written.map((x) => x.item)).toEqual(['t-0', 't-1', 't-2']);
    expect(trailer.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('throws NOT_FOUND without writing any items when no handler owns the topic', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(SubscribeMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Subscribe', 'grpc-test-topic-with-no-handler'),
      serviceResolverFactory,
      pipeline,
    );
    const writer = new FakeServerWritableStream<SubscribeReply>({ request: { topic: 't' } });

    const error = await expectReject(handler.serverStreamingAsync<SubscribeReply>(asWritable(writer)));

    expect(error).toBeInstanceOf(GrpcBenzeneError);
    expect(error.code).toBe(status.NOT_FOUND);
    expect(writer.written).toHaveLength(0);
  });
});

// ── Client-streaming ─────────────────────────────────────────────────────────────────────────────────

describe('GrpcMethodHandler.clientStreamingAsync', () => {
  it('consumes the request stream and returns the single response', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(UploadStreamMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Upload', 'grpc-test-upload-stream-topic'),
      serviceResolverFactory,
      pipeline,
    );
    const reader = new FakeServerReadableStream<UploadItem>([{ value: 1 }, { value: 2 }, { value: 3 }]);

    const { response, trailer } = await handler.clientStreamingAsync<UploadSummary>(asReadable(reader));

    expect(response.total).toBe(6);
    expect(trailer.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('translates a cancelled pipeline into CANCELLED', async () => {
    const { pipeline, serviceResolverFactory } = buildCancellingPipeline();
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/x/y', 'topic'),
      serviceResolverFactory,
      pipeline,
    );
    const reader = new FakeServerReadableStream<UploadItem>([{ value: 1 }], { cancelled: true });

    const error = await expectReject(handler.clientStreamingAsync<UploadSummary>(asReadable(reader)));

    expect(error.code).toBe(status.CANCELLED);
  });
});

// ── Bidirectional streaming ──────────────────────────────────────────────────────────────────────────

describe('GrpcMethodHandler.duplexStreamingAsync', () => {
  it('echoes each request message back onto the response stream', async () => {
    const { pipeline, serviceResolverFactory } = buildPipeline(ChatMessageHandler);
    const handler = new GrpcMethodHandler(
      new GrpcMethodDefinition('/benzene.test.TestService/Chat', 'grpc-test-chat-topic'),
      serviceResolverFactory,
      pipeline,
    );
    const call = new FakeServerDuplexStream<ChatMessage, ChatMessage>([{ text: 'a' }, { text: 'b' }]);

    const trailer = await handler.duplexStreamingAsync<ChatMessage>(asDuplex(call));

    expect(call.written.map((x) => x.text)).toEqual(['Echo: a', 'Echo: b']);
    expect(trailer.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });
});

// ── useGrpc host bridge (streaming) ──────────────────────────────────────────────────────────────────

describe('useGrpc bridge (streaming)', () => {
  it('dispatches a server-streaming call and ends the writer with the benzene-status trailer', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, SubscribeMessageHandler));
    const handler: handleServerStreamingCall<unknown, SubscribeReply> =
      bridge.toServerStreamingHandler('/benzene.test.TestService/Subscribe');
    const writer = new FakeServerWritableStream<SubscribeReply>({ request: { topic: 'host' } });

    handler(asWritable(writer));
    await writer.whenEnded;

    expect(writer.written.map((x) => x.item)).toEqual(['host-0', 'host-1', 'host-2']);
    expect(writer.ended).toBe(true);
    expect(writer.endTrailer?.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('dispatches a client-streaming call through the callback', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, UploadStreamMessageHandler));
    const handler: handleClientStreamingCall<UploadItem, UploadSummary> =
      bridge.toClientStreamingHandler('/benzene.test.TestService/Upload');
    const reader = new FakeServerReadableStream<UploadItem>([{ value: 4 }, { value: 5 }]);

    const result = await new Promise<{ value?: UploadSummary | null; trailer?: Metadata }>(
      (resolve, reject) => {
        handler(asReadable(reader), (err, value, trailer) =>
          err ? reject(err) : resolve({ value, trailer }),
        );
      },
    );

    expect(result.value?.total).toBe(9);
    expect(result.trailer?.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('dispatches a bidi call and ends the duplex with the trailer', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, ChatMessageHandler));
    const handler: handleBidiStreamingCall<ChatMessage, ChatMessage> = bridge.toBidiStreamingHandler(
      '/benzene.test.TestService/Chat',
    );
    const call = new FakeServerDuplexStream<ChatMessage, ChatMessage>([{ text: 'x' }, { text: 'y' }]);

    handler(asDuplex(call));
    await call.whenEnded;

    expect(call.written.map((x) => x.text)).toEqual(['Echo: x', 'Echo: y']);
    expect(call.endTrailer?.get('benzene-status')[0]).toBe(BenzeneResultStatus.ok);
  });

  it('emits a GrpcBenzeneError on the writer when no handler owns a server-streaming method', async () => {
    const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, SubscribeMessageHandler));
    const handler: handleServerStreamingCall<unknown, SubscribeReply> =
      bridge.toServerStreamingHandler('/unknown.Service/Nope');
    const writer = new FakeServerWritableStream<SubscribeReply>({ request: { topic: 't' } });

    const error = await new Promise<GrpcBenzeneError>((resolve) => {
      writer.on('error', (err: GrpcBenzeneError) => resolve(err));
      handler(asWritable(writer));
    });

    expect(error).toBeInstanceOf(GrpcBenzeneError);
    expect(error.code).toBe(status.UNIMPLEMENTED);
    expect(writer.written).toHaveLength(0);
  });
});
