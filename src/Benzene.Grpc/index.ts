/**
 * `@benzene/grpc` — the core **unary server-side** slice of `Benzene.Grpc`: routes gRPC unary calls into
 * Benzene message handlers over `@grpc/grpc-js`, bridging the request/response payloads, inbound metadata
 * (headers), Benzene result status → grpc status code + `benzene-status` trailer, and cancellation.
 *
 * Wire a handler with `@grpcMethod('/pkg.Svc/Method')` + `@message('topic')`, then:
 * ```ts
 * const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoHandler));
 * server.addService(EchoService, { echo: bridge.toUnaryHandler('/pkg.Svc/Echo') });
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * SCOPE — what is PORTED vs DEFERRED (see the README "Porting conventions" bullet for the full rationale):
 *
 * PORTED (the unary server bridge):
 *  - `GrpcContext` (over grpc-js `ServerUnaryCall`), the topic/body/headers getters + result setter +
 *    `GrpcRequestMapper`, `@grpcMethod` discovery (`GrpcMethodDefinition` /
 *    `ReflectionGrpcMethodFinder` / `GrpcRouteFinder`, case-insensitive), the unary `GrpcMethodHandler`
 *    (+ factory/accessor), the full `DefaultGrpcStatusCodeMapper` table, `IGrpcServerCallAccessor`, a
 *    JSON/structural message adapter, `addGrpcMessageHandlers`, and the `useGrpc` host bridge.
 *
 * DEFERRED (deliberately NOT built — do not assume these exist):
 *  - **Non-unary streaming** (server-/client-/bidi-streaming): the .NET `Streaming/` folder,
 *    `GrpcStreamAdapter`, and the three non-unary interceptor overrides. gRPC streaming over grpc-js
 *    `ServerReadableStream`/`ServerWritableStream` ↔ `AsyncIterable` is a substantial, separable concern;
 *    unary is the must-have. The `IGrpcMethodHandler` interface is narrowed to `handleAsync` only.
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
export * from './DependencyInjectionExtensions';
export * from './Extensions';
