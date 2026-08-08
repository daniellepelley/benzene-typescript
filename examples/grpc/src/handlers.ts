/**
 * The greeter domain, written ONCE, transport-agnostic. Ported from the .NET `Benzene.Example.Grpc`
 * handlers (`SayHello…MessageHandler`): one handler per gRPC RPC shape (unary, server-streaming,
 * client-streaming, bidirectional). Each declares its Benzene `@message` topic AND the gRPC method it
 * answers with `@grpcMethod`; it knows nothing about the grpc-js `Server` that delivered the call — the
 * `useGrpc` bridge (see `src/server.ts`) routes the method path to the topic and runs the pipeline.
 *
 * The handlers register with a LOCAL registry (not the global one), and `src/server.ts` passes the handler
 * classes to `useMessageHandlers` explicitly, so importing this example never pollutes another module's
 * handler discovery.
 */
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { message, MessageHandlersRegistry } from '@benzene/core-message-handlers';
import { grpcMethod } from '@benzene/grpc';
import { BenzeneResult } from '@benzene/results';

export const registry = new MessageHandlersRegistry();

/** The request payload for every RPC (`greet.HelloRequest`). */
export class HelloRequest {
  name = '';
}

/** The reply payload for every RPC (`greet.HelloReply`). */
export class HelloReply {
  message = '';
}

/** The greetings the server-streaming RPC fans out for a single name. */
const SALUTATIONS = ['Hello', 'Hi', 'Hey'] as const;

/**
 * Unary: one request in, one reply out. The distinctive "…, this is Benzene" suffix (matching the .NET
 * example) is the proof the call was answered by the Benzene handler rather than a native gRPC service.
 */
@grpcMethod('/greet.Greeter/SayHello')
@message('say_hello', { registry, requestType: HelloRequest, responseType: HelloReply })
export class SayHelloHandler implements IMessageHandler<HelloRequest, HelloReply> {
  handleAsync(request: HelloRequest): Promise<IBenzeneResultOf<HelloReply>> {
    const reply = new HelloReply();
    reply.message = `Hello ${request.name}, this is Benzene`;
    return Promise.resolve(BenzeneResult.ok(reply));
  }
}

/** Server-streaming: one request in, a stream of replies out (one greeting per salutation). */
@grpcMethod('/greet.Greeter/SayHelloServerStream')
@message('say_hello_server_stream', { registry, requestType: HelloRequest })
export class SayHelloServerStreamHandler
  implements IMessageHandler<HelloRequest, AsyncIterable<HelloReply>>
{
  handleAsync(request: HelloRequest): Promise<IBenzeneResultOf<AsyncIterable<HelloReply>>> {
    return Promise.resolve(BenzeneResult.ok(produce(request.name)));
  }
}

async function* produce(name: string): AsyncIterable<HelloReply> {
  for (const salutation of SALUTATIONS) {
    const reply = new HelloReply();
    reply.message = `${salutation} ${name}`;
    yield reply;
  }
}

/** Client-streaming: a stream of requests in, one aggregated reply out. */
@grpcMethod('/greet.Greeter/SayHelloClientStream')
@message('say_hello_client_stream', { registry })
export class SayHelloClientStreamHandler
  implements IMessageHandler<AsyncIterable<HelloRequest>, HelloReply>
{
  async handleAsync(request: AsyncIterable<HelloRequest>): Promise<IBenzeneResultOf<HelloReply>> {
    const names: string[] = [];
    for await (const item of request) {
      names.push(item.name);
    }
    const reply = new HelloReply();
    reply.message = `Hello ${names.join(', ')}`;
    return BenzeneResult.ok(reply);
  }
}

/** Bidirectional: a stream of requests in, a stream of replies out (greet each name as it arrives). */
@grpcMethod('/greet.Greeter/SayHelloBidiStream')
@message('say_hello_bidi_stream', { registry })
export class SayHelloBidiStreamHandler
  implements IMessageHandler<AsyncIterable<HelloRequest>, AsyncIterable<HelloReply>>
{
  handleAsync(
    request: AsyncIterable<HelloRequest>,
  ): Promise<IBenzeneResultOf<AsyncIterable<HelloReply>>> {
    return Promise.resolve(BenzeneResult.ok(echo(request)));
  }
}

async function* echo(source: AsyncIterable<HelloRequest>): AsyncIterable<HelloReply> {
  for await (const item of source) {
    const reply = new HelloReply();
    reply.message = `Hello ${item.name}`;
    yield reply;
  }
}
