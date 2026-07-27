/**
 * `@benzene/grpc` — the server-side slice of `Benzene.Grpc`: routes gRPC calls of **all four RPC shapes**
 * (unary, server-streaming, client-streaming, bidirectional) into Benzene message handlers over
 * `@grpc/grpc-js`, bridging the request/response payloads (and request/response *streams* as
 * `AsyncIterable`), inbound metadata (headers), Benzene result status → grpc status code + `benzene-status`
 * trailer, and cancellation.
 *
 * Wire a handler with `@grpcMethod('/pkg.Svc/Method')` + `@message('topic')`, then register the matching
 * grpc-js handler for its shape:
 * ```ts
 * const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoHandler, ChatHandler));
 * server.addService(ChatService, {
 *   echo: bridge.toUnaryHandler('/pkg.Svc/Echo'),
 *   subscribe: bridge.toServerStreamingHandler('/pkg.Svc/Subscribe'),
 *   upload: bridge.toClientStreamingHandler('/pkg.Svc/Upload'),
 *   chat: bridge.toBidiStreamingHandler('/pkg.Svc/Chat'),
 * });
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * SCOPE — what is PORTED vs DEFERRED (see the README "Porting conventions" bullet for the full rationale):
 *
 * PORTED (the full server bridge):
 *  - `GrpcContext` (over the shared grpc-js `ServerSurfaceCall`, request or request-stream), the
 *    topic/body/headers getters + result setter + `GrpcRequestMapper` (incl. its request-stream branch),
 *    `@grpcMethod` discovery (`GrpcMethodDefinition` / `ReflectionGrpcMethodFinder` / `GrpcRouteFinder`,
 *    case-insensitive), the `GrpcMethodHandler` for **all four shapes** (unary + server-/client-/bidi-
 *    streaming, + factory/accessor), the `Streaming/GrpcStreamAdapter` (grpc-js streams ↔ `AsyncIterable`,
 *    per-item adapter conversion), the full `DefaultGrpcStatusCodeMapper` table, `IGrpcServerCallAccessor`,
 *    a JSON/structural message adapter, `addGrpcMessageHandlers`, and the `useGrpc` host bridge (with a
 *    `to*Handler` per shape).
 *
 * DEFERRED (deliberately NOT built — do not assume these exist):
 *  - **The outbound client** (`Benzene.Grpc.Client`) — a separate package/concern.
 *  - **The ASP.NET Core hosting glue** (`Benzene.Grpc.AspNet`) and the `BenzeneInterceptor` — no JS analog;
 *    the grpc-js `Server` is the host, so `GrpcBenzeneBridge`/`useGrpc` replace both.
 *  - **Rich `google.rpc.Status` error details** (`grpc-status-details-bin`, `google.rpc.BadRequest`
 *    field violations) — protobuf-only; the flat `benzene-status` trailer IS ported.
 *  - **Protobuf codec specifics** (`ProtobufJsonGrpcMessageAdapter`'s descriptor-driven parse) — grpc-js
 *    ships no framework message type; the adapter is a JSON/structural pass-through (see
 *    `JsonGrpcMessageAdapter`). Any gRPC health-check type is intentionally out of scope.
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 */
export * from './GrpcContext';
export * from './GrpcMethodAttribute';
export * from './IGrpcMethodDefinition';
export * from './GrpcMethodDefinition';
export * from './IGrpcMethodFinder';
export * from './ReflectionGrpcMethodFinder';
export * from './IGrpcRouteFinder';
export * from './GrpcRouteFinder';
export * from './IGrpcMethodHandler';
export * from './GrpcMethodHandler';
export * from './IGrpcMethodHandlerFactory';
export * from './GrpcMethodHandlerFactory';
export * from './IGrpcMethodHandlerFactoryAccessor';
export * from './GrpcMethodHandlerFactoryAccessor';
export * from './GrpcMessageTopicGetter';
export * from './GrpcMessageBodyGetter';
export * from './GrpcMessageHeadersGetter';
export * from './GrpcMessageHandlerResultSetter';
export * from './GrpcRequestMapper';
export * from './IGrpcStatusCodeMapper';
export * from './DefaultGrpcStatusCodeMapper';
export * from './IGrpcServerCallAccessor';
export * from './GrpcServerCallAccessor';
export * from './GrpcBenzeneError';
export * from './Serialization/IGrpcMessageAdapter';
export * from './Serialization/JsonGrpcMessageAdapter';
export * from './Streaming/GrpcStreamAdapter';
export * from './DependencyInjectionExtensions';
export * from './Extensions';
