import {
  Client,
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  ServiceDefinition,
  status,
  type ServiceError,
} from '@grpc/grpc-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import {
  IMessageHandlerDefinition,
  IMessageHandlersFinder,
} from '@benzenejs/abstractions-message-handlers';
import { BenzeneException } from '@benzenejs/core';
import {
  MessageHandlerDefinition,
  MessageHandlersRegistry,
  message,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import {
  decodeFieldViolations,
  grpcMethod,
  GRPC_STATUS_DETAILS_TRAILER,
  ReflectionGrpcMethodFinder,
  useGrpc,
} from '@benzenejs/grpc';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';

/**
 * Vitest port of the .NET #280 regression tests (GrpcMethodHandlerStreamingTest's
 * `*_WhenHandlerThrowsMidStream_ClassifiesTheExceptionAndWritesAFailureTrailer` pair), driven over a
 * REAL in-process `@grpc/grpc-js` `Server` + `Client` on a loopback socket.
 *
 * #280's bug shape: the streaming pipeline decides the success trailer BEFORE the handler's async
 * iterator ever runs, so a handler that throws partway through producing items must not surface as an
 * unclassified `UNKNOWN` with a stale success `benzene-status` trailer. The truthful outcome is the
 * same classification a unary handler's exception gets (a plain `Error` → the generic
 * service-unavailable bucket), run through the same status mapper and rich-error-details path:
 * mapped code + truthful `benzene-status` trailer + `grpc-status-details-bin` — never `ok`.
 *
 * Driving a real server (as GrpcRichErrorDetailsTest does) rather than the hand-rolled stream fakes is
 * the point: the items written before the throw, the final status code, and the trailers all make a
 * genuine wire round trip, so an early-flushed success trailer or a swallowed classification fails
 * here rather than passing a unit test.
 */

const SUBSCRIBE_THROWING = '/benzene.test.TestService/SubscribeThrowing';
const CHAT_THROWING = '/benzene.test.TestService/ChatThrowing';

const SUBSCRIBE_THROWING_TOPIC = 'grpc-test-subscribe-throwing-topic';
const CHAT_THROWING_TOPIC = 'grpc-test-chat-throwing-topic';

class SubscribeRequest {
  topic = '';
}
class SubscribeReply {
  item = '';
}
class ChatMessage {
  text = '';
}

const registry = new MessageHandlersRegistry();

/**
 * Same shape as GrpcStreamingTest's SubscribeMessageHandler, but throws partway through producing
 * items — the port of .NET's SubscribeThrowingMidStreamMessageHandler.
 */
@grpcMethod(SUBSCRIBE_THROWING)
@message(SUBSCRIBE_THROWING_TOPIC, { registry, requestType: SubscribeRequest })
class SubscribeThrowingMidStreamMessageHandler
  implements IMessageHandler<SubscribeRequest, AsyncIterable<SubscribeReply>>
{
  handleAsync(request: SubscribeRequest): Promise<IBenzeneResultOf<AsyncIterable<SubscribeReply>>> {
    return Promise.resolve(BenzeneResult.ok(produceThenThrow(request.topic)));
  }
}

async function* produceThenThrow(topic: string): AsyncIterable<SubscribeReply> {
  const reply = new SubscribeReply();
  reply.item = `${topic}-0`;
  yield reply;
  await Promise.resolve();
  throw new Error('boom mid-stream');
}

/** The duplex-streaming shape of the same regression — .NET's ChatThrowingMidStreamMessageHandler. */
@grpcMethod(CHAT_THROWING)
@message(CHAT_THROWING_TOPIC, { registry })
class ChatThrowingMidStreamMessageHandler
  implements IMessageHandler<AsyncIterable<ChatMessage>, AsyncIterable<ChatMessage>>
{
  handleAsync(
    request: AsyncIterable<ChatMessage>,
  ): Promise<IBenzeneResultOf<AsyncIterable<ChatMessage>>> {
    return Promise.resolve(BenzeneResult.ok(echoOneThenThrow(request)));
  }
}

async function* echoOneThenThrow(source: AsyncIterable<ChatMessage>): AsyncIterable<ChatMessage> {
  for await (const incoming of source) {
    const outgoing = new ChatMessage();
    outgoing.text = `Echo: ${incoming.text}`;
    yield outgoing;
    throw new Error('boom mid-stream');
  }
}

// Same hand-built JSON codec as GrpcRichErrorDetailsTest — POCO payloads, no .proto needed.
const jsonCodec = {
  serialize: (value: unknown): Buffer => Buffer.from(JSON.stringify(value ?? null), 'utf8'),
  deserialize: (bytes: Buffer): unknown => JSON.parse(bytes.toString('utf8')) as unknown,
};

const testService: ServiceDefinition = {
  subscribeThrowing: {
    path: SUBSCRIBE_THROWING,
    requestStream: false,
    responseStream: true,
    requestSerialize: jsonCodec.serialize,
    requestDeserialize: jsonCodec.deserialize,
    responseSerialize: jsonCodec.serialize,
    responseDeserialize: jsonCodec.deserialize,
  } as ServiceDefinition[string],
  chatThrowing: {
    path: CHAT_THROWING,
    requestStream: true,
    responseStream: true,
    requestSerialize: jsonCodec.serialize,
    requestDeserialize: jsonCodec.deserialize,
    responseSerialize: jsonCodec.serialize,
    responseDeserialize: jsonCodec.deserialize,
  } as ServiceDefinition[string],
};

interface StreamOutcome<T> {
  items: T[];
  error: ServiceError;
}

describe('gRPC mid-stream handler throw (#280) over a real server', () => {
  let server: Server;
  let rawClient: Client;

  beforeAll(async () => {
    const bridge = useGrpc((pipeline) =>
      useMessageHandlers(
        pipeline,
        SubscribeThrowingMidStreamMessageHandler,
        ChatThrowingMidStreamMessageHandler,
      ),
    );

    server = new Server();
    server.addService(testService, {
      subscribeThrowing: bridge.toServerStreamingHandler(SUBSCRIBE_THROWING),
      chatThrowing: bridge.toBidiStreamingHandler(CHAT_THROWING),
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.bindAsync('127.0.0.1:0', ServerCredentials.createInsecure(), (error, bound) =>
        error ? reject(error) : resolve(bound),
      );
    });

    rawClient = new Client(`127.0.0.1:${port}`, credentials.createInsecure());
  });

  afterAll(async () => {
    rawClient.close();
    await new Promise<void>((resolve) => server.tryShutdown(() => resolve()));
  });

  function expectTruthfulFailure<T>(outcome: StreamOutcome<T>): void {
    // The mapped code — a plain Error classifies like a unary handler's exception: the generic
    // service-unavailable bucket, never UNKNOWN.
    expect(outcome.error.code).toBe(status.UNAVAILABLE);
    expect(outcome.error.details).toBe('boom mid-stream');

    // The trailer is truthful — the classified failure status, never the stale success `ok` the
    // pipeline had already decided before the iterator ran.
    const benzeneStatus = outcome.error.metadata?.get('benzene-status');
    expect(benzeneStatus).toEqual([BenzeneResultStatus.serviceUnavailable]);

    // The rich error details ride along (`google.rpc.Status` in `grpc-status-details-bin`); no field
    // violations, since a thrown exception carries no structured errors — but the detail is attached.
    const details = outcome.error.metadata?.get(GRPC_STATUS_DETAILS_TRAILER)[0];
    expect(Buffer.isBuffer(details)).toBe(true);
    expect(decodeFieldViolations(details as Buffer)).toEqual([]);
  }

  it('server-streaming: items before the throw arrive, then the classified failure with a truthful trailer', async () => {
    const outcome = await new Promise<StreamOutcome<SubscribeReply>>((resolve, reject) => {
      const items: SubscribeReply[] = [];
      const call = rawClient.makeServerStreamRequest<SubscribeRequest, SubscribeReply>(
        SUBSCRIBE_THROWING,
        jsonCodec.serialize,
        jsonCodec.deserialize as (bytes: Buffer) => SubscribeReply,
        { topic: 't' },
      );
      call.on('data', (item: SubscribeReply) => items.push(item));
      call.on('error', (error: ServiceError) => resolve({ items, error }));
      call.on('end', () => reject(new Error('Expected the call to fail, but it ended cleanly.')));
    });

    expect(outcome.items.map((x) => x.item)).toEqual(['t-0']);
    expectTruthfulFailure(outcome);
  });

  it('bidi-streaming: the echoed item arrives, then the classified failure with a truthful trailer', async () => {
    const outcome = await new Promise<StreamOutcome<ChatMessage>>((resolve, reject) => {
      const items: ChatMessage[] = [];
      const call = rawClient.makeBidiStreamRequest<ChatMessage, ChatMessage>(
        CHAT_THROWING,
        jsonCodec.serialize,
        jsonCodec.deserialize as (bytes: Buffer) => ChatMessage,
      );
      call.on('data', (item: ChatMessage) => items.push(item));
      call.on('error', (error: ServiceError) => resolve({ items, error }));
      call.on('end', () => reject(new Error('Expected the call to fail, but it ended cleanly.')));
      call.write({ text: 'a' });
      call.write({ text: 'b' });
      call.end();
    });

    expect(outcome.items.map((x) => x.text)).toEqual(['Echo: a']);
    expectTruthfulFailure(outcome);
  });
});

describe('ReflectionGrpcMethodFinder duplicate case-fold (#261)', () => {
  it('throws when two handlers share a gRPC method differing only by case', () => {
    // #261: the duplicate check must case-fold the same way GrpcRouteFinder's lower-cased route map
    // does, so the collision fails fast with a clear BenzeneException rather than silently losing one
    // route to last-in-wins in the map.
    @grpcMethod('/pkg.service/casefolded')
    class HandlerCasedLower {}
    @grpcMethod('/Pkg.Service/CaseFolded')
    class HandlerCasedUpper {}

    const definitionFor = (type: new () => unknown, topic: string): IMessageHandlerDefinition =>
      MessageHandlerDefinition.createInstance(topic, '', type, type, type);

    const messageHandlersFinder: IMessageHandlersFinder = {
      findDefinitions: () => [
        definitionFor(HandlerCasedLower, 'topic-lower'),
        definitionFor(HandlerCasedUpper, 'topic-upper'),
      ],
    };

    expect(() => new ReflectionGrpcMethodFinder(messageHandlersFinder).findDefinitions()).toThrow(
      BenzeneException,
    );
  });
});
