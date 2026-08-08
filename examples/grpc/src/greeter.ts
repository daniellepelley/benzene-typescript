/**
 * The grpc-js wire contract for the Greeter service, all four RPC shapes. In .NET this comes from
 * `Protos/greet.proto` compiled to a strongly-typed `Greeter.GreeterBase`/`GreeterClient`; grpc-js ships
 * no framework message type, so — exactly like `@benzene/grpc`'s `JsonGrpcMessageAdapter` and
 * `@benzene/grpc-client`'s `jsonGrpcMarshaller` — we marshal the `{ name }` / `{ message }` payloads as
 * JSON on the wire. The same `ServiceDefinition` is registered on the server and used by the raw client in
 * the test, so both ends agree on the codec.
 */
import { ServiceDefinition } from '@grpc/grpc-js';
import { HelloReply, HelloRequest } from './handlers';

const serialize = <T>(value: T): Buffer => Buffer.from(JSON.stringify(value ?? null), 'utf8');
const deserializeRequest = (bytes: Buffer): HelloRequest =>
  Object.assign(new HelloRequest(), JSON.parse(bytes.toString('utf8')));
const deserializeReply = (bytes: Buffer): HelloReply =>
  Object.assign(new HelloReply(), JSON.parse(bytes.toString('utf8')));

/** Fully-qualified gRPC method paths — the strings the `@grpcMethod` handlers are decorated with. */
export const GreeterMethods = {
  sayHello: '/greet.Greeter/SayHello',
  sayHelloServerStream: '/greet.Greeter/SayHelloServerStream',
  sayHelloClientStream: '/greet.Greeter/SayHelloClientStream',
  sayHelloBidiStream: '/greet.Greeter/SayHelloBidiStream',
} as const;

/** The grpc-js `ServiceDefinition` for `greet.Greeter`, JSON-marshalled (see file header). */
export const greeterServiceDefinition: ServiceDefinition = {
  sayHello: {
    path: GreeterMethods.sayHello,
    requestStream: false,
    responseStream: false,
    requestSerialize: serialize,
    requestDeserialize: deserializeRequest,
    responseSerialize: serialize,
    responseDeserialize: deserializeReply,
  },
  sayHelloServerStream: {
    path: GreeterMethods.sayHelloServerStream,
    requestStream: false,
    responseStream: true,
    requestSerialize: serialize,
    requestDeserialize: deserializeRequest,
    responseSerialize: serialize,
    responseDeserialize: deserializeReply,
  },
  sayHelloClientStream: {
    path: GreeterMethods.sayHelloClientStream,
    requestStream: true,
    responseStream: false,
    requestSerialize: serialize,
    requestDeserialize: deserializeRequest,
    responseSerialize: serialize,
    responseDeserialize: deserializeReply,
  },
  sayHelloBidiStream: {
    path: GreeterMethods.sayHelloBidiStream,
    requestStream: true,
    responseStream: true,
    requestSerialize: serialize,
    requestDeserialize: deserializeRequest,
    responseSerialize: serialize,
    responseDeserialize: deserializeReply,
  },
};
