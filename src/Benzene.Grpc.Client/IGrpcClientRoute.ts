import { Client } from '@grpc/grpc-js';
import { IGrpcMessageAdapter } from '@benzene/grpc';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';

/**
 * Port of Benzene.Grpc.Client.IGrpcClientRoute.
 *
 * A registered gRPC client call, closed over its request/response wire types. Bridges the
 * topic-addressed, boxed-payload world of {@link GrpcSendMessageContext} to a strongly-typed unary
 * invocation.
 *
 * BEND (`Grpc.Core.CallInvoker` → grpc-js `Client`): .NET invokes through a `CallInvoker`
 * (`channel.CreateCallInvoker()`); `@grpc/grpc-js` exposes the equivalent low-level unary entry point as
 * `Client.makeUnaryRequest`, so the route takes the caller-supplied grpc-js `Client` — the same
 * caller-owns-the-transport-client shape as the SQS/Kafka/RabbitMQ send sides.
 */
export interface IGrpcClientRoute {
  invokeAsync(client: Client, adapter: IGrpcMessageAdapter, context: GrpcSendMessageContext): Promise<void>;
}
