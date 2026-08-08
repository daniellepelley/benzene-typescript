/**
 * Drives `@benzene-example/grpc` end-to-end. Ports the four RPC-shape assertions of the .NET
 * `GreeterServiceTest`; the unary reply's "…, this is Benzene" suffix proves the Benzene handler answered.
 *
 * Two seams, matching how this port itself tests gRPC:
 *  - UNARY runs over a REAL grpc-js socket: the greeter server is bound to an ephemeral loopback port and
 *    called through the Benzene `@benzene/grpc-client` message client — proof `@benzene/grpc` (server) and
 *    `@benzene/grpc-client` talk over the wire — plus a front-door call through `@benzene/grpc-test-helpers`.
 *  - The three STREAMING shapes run through the `useGrpc` bridge with in-memory fake grpc-js streams, the
 *    same deterministic seam the port's own `GrpcStreamingTest` uses (a live grpc-js bidi half-close is not
 *    reliably testable in-process). This still boots the real StartUp — `greeterBridge()` — and pushes a
 *    message through the front door (`bridge.to*Handler`).
 */
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  credentials,
  handleBidiStreamingCall,
  handleClientStreamingCall,
  handleServerStreamingCall,
  Metadata,
  Server,
  ServerDuplexStream,
  ServerReadableStream,
  ServerWritableStream,
} from '@grpc/grpc-js';
import { Client } from '@grpc/grpc-js';
import { sendMessageAsync } from '@benzene/clients';
import { BenzeneResultStatus } from '@benzene/results';
import { createServerUnaryCall } from '@benzene/grpc-test-helpers';
import {
  createGreeterClient,
  GreeterMethods,
  greeterBridge,
  HelloReply,
  HelloRequest,
  startGreeterServer,
} from '@benzene-example/grpc';

function hello(name: string): HelloRequest {
  return Object.assign(new HelloRequest(), { name });
}

// ── In-memory fake grpc-js streams (ported from the port's own GrpcStreamingTest) ──────────────────────

/** A fake ServerWritableStream (server-streaming) that records every written reply + the end trailer. */
class FakeWritable<TRes> extends EventEmitter {
  readonly written: TRes[] = [];
  readonly whenEnded: Promise<void>;
  private resolveEnded!: () => void;
  constructor(readonly request: unknown) {
    super();
    this.whenEnded = new Promise((resolve) => (this.resolveEnded = resolve));
  }
  readonly metadata = new Metadata();
  readonly cancelled = false;
  getDeadline() {
    return Infinity;
  }
  getPath() {
    return GreeterMethods.sayHelloServerStream;
  }
  write(item: TRes): boolean {
    this.written.push(item);
    return true;
  }
  end(): this {
    this.resolveEnded();
    return this;
  }
}

/** A fake ServerReadableStream (client-streaming) yielding a fixed request sequence. */
class FakeReadable<TReq> extends EventEmitter {
  constructor(private readonly items: TReq[]) {
    super();
  }
  readonly metadata = new Metadata();
  readonly cancelled = false;
  getDeadline() {
    return Infinity;
  }
  getPath() {
    return GreeterMethods.sayHelloClientStream;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<TReq> {
    yield* this.items;
  }
}

/** A fake ServerDuplexStream (bidi) that yields a fixed request sequence and records writes. */
class FakeDuplex<TReq, TRes> extends EventEmitter {
  readonly written: TRes[] = [];
  readonly whenEnded: Promise<void>;
  private resolveEnded!: () => void;
  constructor(private readonly items: TReq[]) {
    super();
    this.whenEnded = new Promise((resolve) => (this.resolveEnded = resolve));
  }
  readonly metadata = new Metadata();
  readonly cancelled = false;
  getDeadline() {
    return Infinity;
  }
  getPath() {
    return GreeterMethods.sayHelloBidiStream;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<TReq> {
    yield* this.items;
  }
  write(item: TRes): boolean {
    this.written.push(item);
    return true;
  }
  end(): this {
    this.resolveEnded();
    return this;
  }
}

// ── Real-socket unary ──────────────────────────────────────────────────────────────────────────────────

let server: Server;
let address: string;

beforeAll(async () => {
  const started = await startGreeterServer();
  server = started.server;
  address = `127.0.0.1:${started.port}`;
});

afterAll(() => {
  server.forceShutdown();
});

describe('@benzene-example/grpc', () => {
  it('unary (Benzene client, real socket): SayHello routes through the Benzene handler', async () => {
    const { messageClient, grpcClient } = createGreeterClient(address);

    const result = await sendMessageAsync<HelloRequest, HelloReply>(messageClient, 'say_hello', hello('acme'));

    expect(result.isSuccessful).toBe(true);
    expect(result.status).toBe(BenzeneResultStatus.ok);
    // The Benzene handler appends ", this is Benzene" — proof it answered, not a native gRPC service.
    expect(result.payload.message).toBe('Hello acme, this is Benzene');
    grpcClient.close();
  });

  it('unary (front door): the bridge answers a createServerUnaryCall directly', async () => {
    const unary = greeterBridge().toUnaryHandler<HelloRequest, HelloReply>(GreeterMethods.sayHello);

    const reply = await new Promise<HelloReply>((resolve, reject) => {
      unary(createServerUnaryCall({ request: hello('front-door') }), (error, value) =>
        error || !value ? reject(error) : resolve(value),
      );
    });

    expect(reply.message).toBe('Hello front-door, this is Benzene');
  });

  it('server-streaming: SayHelloServerStream fans out one greeting per salutation', async () => {
    const handler: handleServerStreamingCall<HelloRequest, HelloReply> =
      greeterBridge().toServerStreamingHandler(GreeterMethods.sayHelloServerStream);
    const writable = new FakeWritable<HelloReply>(hello('acme'));

    handler(writable as unknown as ServerWritableStream<HelloRequest, HelloReply>);
    await writable.whenEnded;

    expect(writable.written.map((r) => r.message)).toEqual(['Hello acme', 'Hi acme', 'Hey acme']);
  });

  it('client-streaming: SayHelloClientStream aggregates every uploaded name', async () => {
    const handler: handleClientStreamingCall<HelloRequest, HelloReply> =
      greeterBridge().toClientStreamingHandler(GreeterMethods.sayHelloClientStream);
    const readable = new FakeReadable<HelloRequest>(['Alice', 'Bob', 'Carol'].map(hello));

    const reply = await new Promise<HelloReply>((resolve, reject) => {
      handler(readable as unknown as ServerReadableStream<HelloRequest, HelloReply>, (error, value) =>
        error || !value ? reject(error) : resolve(value),
      );
    });

    expect(reply.message).toBe('Hello Alice, Bob, Carol');
  });

  it('bidirectional: SayHelloBidiStream greets each name as it arrives', async () => {
    const handler: handleBidiStreamingCall<HelloRequest, HelloReply> = greeterBridge().toBidiStreamingHandler(
      GreeterMethods.sayHelloBidiStream,
    );
    const duplex = new FakeDuplex<HelloRequest, HelloReply>(['Dave', 'Erin'].map(hello));

    handler(duplex as unknown as ServerDuplexStream<HelloRequest, HelloReply>);
    await duplex.whenEnded;

    expect(duplex.written.map((r) => r.message)).toEqual(['Hello Dave', 'Hello Erin']);
  });
});
