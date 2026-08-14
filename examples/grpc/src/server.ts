/**
 * The gRPC server composition root — the Benzene ⇄ grpc-js bridge and the grpc-js `Server` that hosts it.
 * This is the TypeScript analog of the .NET example's `Program.cs`: there it is ASP.NET Core + a
 * `BenzeneInterceptor`; here (there is no ASP.NET in Node) the grpc-js `Server` *is* the host and
 * `useGrpc` returns the bridge whose `to*Handler` methods ARE the service implementation.
 */
import {
  Server,
  ServerCredentials,
  ServiceDefinition,
  UntypedServiceImplementation,
} from '@grpc/grpc-js';
import { useMessageHandlers } from '@benzenejs/core-message-handlers';
import { GrpcBenzeneBridge, useGrpc } from '@benzenejs/grpc';
import { greeterServiceDefinition, GreeterMethods } from './greeter';
import {
  HelloReply,
  HelloRequest,
  SayHelloBidiStreamHandler,
  SayHelloClientStreamHandler,
  SayHelloHandler,
  SayHelloServerStreamHandler,
} from './handlers';

/**
 * Builds the Benzene gRPC bridge for the greeter domain: `useGrpc` builds a container, registers the four
 * greeter handlers on the pipeline, and returns the {@link GrpcBenzeneBridge} the grpc-js `Server`
 * dispatches through. This is the "StartUp" a component test drives through the front door.
 */
export function greeterBridge(): GrpcBenzeneBridge {
  return useGrpc((pipeline) =>
    useMessageHandlers(
      pipeline,
      SayHelloHandler,
      SayHelloServerStreamHandler,
      SayHelloClientStreamHandler,
      SayHelloBidiStreamHandler,
    ),
  );
}

/** Maps the greeter {@link ServiceDefinition} onto the bridge — one `to*Handler` per RPC shape. */
export function greeterImplementation(bridge: GrpcBenzeneBridge): UntypedServiceImplementation {
  return {
    sayHello: bridge.toUnaryHandler<HelloRequest, HelloReply>(GreeterMethods.sayHello),
    sayHelloServerStream: bridge.toServerStreamingHandler<HelloRequest, HelloReply>(
      GreeterMethods.sayHelloServerStream,
    ),
    sayHelloClientStream: bridge.toClientStreamingHandler<HelloRequest, HelloReply>(
      GreeterMethods.sayHelloClientStream,
    ),
    sayHelloBidiStream: bridge.toBidiStreamingHandler<HelloRequest, HelloReply>(
      GreeterMethods.sayHelloBidiStream,
    ),
    // The keys line up with `greeterServiceDefinition`; grpc-js matches on each method's `path`.
  };
}

/** Builds a grpc-js `Server` with the greeter service wired to the Benzene bridge (not yet bound). */
export function createGreeterServer(): Server {
  const server = new Server();
  const bridge = greeterBridge();
  server.addService(greeterServiceDefinition as ServiceDefinition, greeterImplementation(bridge));
  return server;
}

/** Binds {@link createGreeterServer} to an ephemeral loopback port. Resolves with the server + its port. */
export function startGreeterServer(host = '127.0.0.1'): Promise<{ server: Server; port: number }> {
  const server = createGreeterServer();
  return new Promise((resolve, reject) => {
    server.bindAsync(`${host}:0`, ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ server, port });
    });
  });
}
