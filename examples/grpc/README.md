# `@benzene-example/grpc`

One greeter domain, **hosted on gRPC across all four RPC shapes** — unary, server-streaming,
client-streaming, and bidirectional. The handlers in [`src/handlers.ts`](src/handlers.ts) are written
once and know nothing about grpc-js; the [`useGrpc`](../../src/Benzene.Grpc) bridge routes each gRPC
method to the handler's Benzene topic and runs the pipeline. Ported from the .NET `Benzene.Example.Grpc`
(server + client + component test).

| Handler (`src/handlers.ts`) | RPC shape | gRPC method | Topic |
|---|---|---|---|
| `SayHelloHandler` | unary | `/greet.Greeter/SayHello` | `say_hello` |
| `SayHelloServerStreamHandler` | server-streaming | `/greet.Greeter/SayHelloServerStream` | `say_hello_server_stream` |
| `SayHelloClientStreamHandler` | client-streaming | `/greet.Greeter/SayHelloClientStream` | `say_hello_client_stream` |
| `SayHelloBidiStreamHandler` | bidirectional | `/greet.Greeter/SayHelloBidiStream` | `say_hello_bidi_stream` |

Each handler declares its `@grpcMethod('/greet.Greeter/…')` alongside `@message('topic')`; the
`useGrpc` bridge (built in [`src/server.ts`](src/server.ts)) exposes one grpc-js handler per shape:

```ts
const bridge = greeterBridge();
server.addService(greeterServiceDefinition, {
  sayHello: bridge.toUnaryHandler('/greet.Greeter/SayHello'),
  sayHelloServerStream: bridge.toServerStreamingHandler('/greet.Greeter/SayHelloServerStream'),
  sayHelloClientStream: bridge.toClientStreamingHandler('/greet.Greeter/SayHelloClientStream'),
  sayHelloBidiStream: bridge.toBidiStreamingHandler('/greet.Greeter/SayHelloBidiStream'),
});
```

## No ASP.NET, no interceptor

The .NET example hosts gRPC on ASP.NET Core and routes Benzene handlers with a `BenzeneInterceptor`. Node
has no ASP.NET Core: the grpc-js `Server` **is** the host, so `useGrpc` returns a bridge whose
`to*Handler` methods **are** the service implementation you pass to `server.addService(...)`. Same idea,
one fewer layer.

## Wire codec

`greet.proto` compiles to strongly-typed protobuf messages in .NET. grpc-js ships no framework message
type, so — exactly like `@benzenejs/grpc`'s `JsonGrpcMessageAdapter` and `@benzenejs/grpc-client`'s
`jsonGrpcMarshaller` — the `{ name }` / `{ message }` payloads are marshalled as **JSON** on the wire (see
[`src/greeter.ts`](src/greeter.ts)). The same `ServiceDefinition` is shared by the server and the client.

## The client

`@benzenejs/grpc-client` ports the **unary** send side: [`src/client.ts`](src/client.ts) wires a Benzene
`IBenzeneMessageClient` that sends the `say_hello` topic over gRPC and maps the gRPC status back to a
Benzene result. Streaming client calls are a deferred, separable concern in the port, so the streaming
RPCs are exercised in the test with grpc-js's own low-level streaming client methods.

## Verify it

`test/Benzene.Core.Test/Examples/GrpcExampleTest.test.ts` boots the real server on an ephemeral loopback
port and drives every RPC shape end-to-end over a real socket, plus a front-door unary call through
`@benzenejs/grpc-test-helpers`' `createServerUnaryCall`. The unary reply's distinctive "…, this is Benzene"
suffix is the proof the Benzene handler answered the call.
