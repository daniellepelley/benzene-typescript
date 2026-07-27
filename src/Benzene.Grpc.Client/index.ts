/**
 * `@benzene/grpc-client` — the TypeScript port of `Benzene.Grpc.Client`: the OUTBOUND gRPC client.
 * A {@link GrpcBenzeneMessageClient} (an `IBenzeneMessageClient`) sends unary calls through a Benzene
 * middleware pipeline over a caller-supplied `@grpc/grpc-js` `Client`, with a topic → method route table
 * and a reverse status mapper (grpc status → Benzene result status, the inverse of `@benzene/grpc`'s
 * server-side mapper).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * SCOPE — PORTED vs DEFERRED (see the README "Porting conventions" bullet for the full rationale):
 *
 * PORTED (the unary send side):
 *  - `GrpcSendMessageContext`, `GrpcContextConverter` (outbound context → gRPC call), `GrpcClientMiddleware`
 *    (performs the unary call, captures a `ServiceError`'s status/trailers), `GrpcBenzeneMessageClient`
 *    (the `IBenzeneMessageClient`), the route registry (`IGrpcClientRouteRegistry`/`GrpcClientRouteRegistry`
 *    + `IGrpcClientRoute`/`GrpcClientRoute`), the full `DefaultGrpcStatusReverseMapper` table
 *    (`IGrpcStatusReverseMapper`), and DI + pipeline extensions (`addGrpcClient` / `useGrpcClient` /
 *    `useGrpc`).
 *
 * DEFERRED (deliberately NOT built — do not assume these exist):
 *  - **The gRPC health check** (`GrpcHealthCheck`, `AddGrpcHealthCheck`, the `AddGrpcClient(healthCheck:)`
 *    parameter) — the health-check domain is out of scope for this port, as it is for `@benzene/grpc`.
 *  - **Non-unary streaming** client calls — unary is the must-have; streaming over grpc-js does not map
 *    cleanly and is a separable concern (same stance as `@benzene/grpc`'s server side).
 *  - **Inbound-deadline / cancellation-token propagation** — `@benzene/grpc`'s `IGrpcServerCallAccessor`
 *    exposes no deadline and there is no ambient cancellation-token DI seam, so `GrpcBenzeneMessageClient`
 *    forwards neither by default (an explicit deadline can still be set via `GrpcContextConverter`).
 *  - **Protobuf wire codec** — `@grpc/grpc-js` ships no framework message type, so routes carry a
 *    JSON/structural `GrpcClientMarshaller` by default (the analog of `@benzene/grpc`'s
 *    `JsonGrpcMessageAdapter` bend); a caller talking to a protobuf service passes a protobuf marshaller.
 *
 * BEND (`GrpcChannel`/`CallInvoker`/`RpcException` → grpc-js `Client`/`makeUnaryRequest`/`ServiceError`):
 *  the caller supplies the `@grpc/grpc-js` `Client`, matching how the SQS/Kafka/RabbitMQ send sides take
 *  their `SQSClient`/`Producer`/`Channel`.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export * from './IGrpcStatusReverseMapper';
export * from './DefaultGrpcStatusReverseMapper';
export * from './GrpcSendMessageContext';
export * from './IGrpcClientRoute';
export * from './GrpcClientRoute';
export * from './IGrpcClientRouteRegistry';
export * from './GrpcClientRouteRegistry';
export * from './GrpcClientMiddleware';
export * from './GrpcContextConverter';
export * from './GrpcBenzeneMessageClient';
export * from './Extensions';
export * from './DependencyInjectionExtensions';
