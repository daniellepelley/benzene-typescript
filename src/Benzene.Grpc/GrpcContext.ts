import { Deadline, Metadata, ServerUnaryCall } from '@grpc/grpc-js';
import {
  IHasMessageResult,
  IMessageHandlerResult,
  IMessageResult,
} from '@benzene/abstractions-message-handlers';

/**
 * The shared surface of every grpc-js server call, across all four RPC shapes — the port's stand-in for
 * grpc-js's own `ServerSurfaceCall` (which `@grpc/grpc-js` declares internally but does **not** re-export
 * from its package root, so it can't be imported). It captures exactly the members Benzene reads off the
 * call regardless of shape: inbound {@link Metadata}, cancellation state, deadline and method path. Each
 * concrete grpc-js call ({@link ServerUnaryCall}, `ServerReadableStream`, `ServerWritableStream`,
 * `ServerDuplexStream`) is structurally assignable to it. This is the faithful analog of .NET's single
 * `ServerCallContext`, shared by all shapes.
 */
export interface GrpcServerCall {
  readonly metadata: Metadata;
  readonly cancelled: boolean;
  getDeadline(): Deadline;
  getPath(): string;
}

/**
 * Port of Benzene.Grpc.GrpcContext.
 *
 * The middleware-pipeline context for a single gRPC call **of any shape** (unary, server-streaming,
 * client-streaming, bidirectional): it carries the grpc-js call (call + inbound {@link Metadata}), the
 * request payload, the buffered response metadata (headers), and — via {@link IHasMessageResult} — the
 * handler's result.
 *
 * SDK-MODEL BEND (`ServerCallContext` → the shared {@link GrpcServerCall} surface): .NET's `Grpc.Core.ServerCallContext` is an
 * abstract per-call context distinct from the request message, shared by every RPC shape. `@grpc/grpc-js`
 * has no single such object; instead each shape gets a purpose-built call — `ServerUnaryCall`,
 * `ServerReadableStream`, `ServerWritableStream`, `ServerDuplexStream` — but all four share the common
 * surface captured by {@link GrpcServerCall} (`metadata`, `cancelled`, `getDeadline()`, `getPath()`). The port
 * therefore stores the call as {@link GrpcServerCall} (the faithful analog of the shared `ServerCallContext`)
 * so the getters/accessor work identically across shapes. .NET folds the request into that context via a
 * `(request, ServerCallContext)` pair; the port keeps them separate too — `requestAsObject` is supplied
 * explicitly (below) rather than reflected off the call, because only the unary/server-streaming shapes
 * expose a `.request` and the client/bidi shapes present the request as an `AsyncIterable`.
 *
 * STREAMING (`IAsyncEnumerable<T>` → `AsyncIterable<T>`): for server-streaming the request is the unary
 * `call.request`; for client-/bidi-streaming it is an `AsyncIterable<TItem>` of the inbound stream. In
 * every case `requestAsObject` returns whatever was passed to the constructor — `GrpcMethodHandler` passes
 * `call.request` for the request-carrying shapes and the request `AsyncIterable` for the stream-in shapes,
 * exactly as .NET instantiates `GrpcContext<TRequest,TResponse>` with `TRequest = IAsyncEnumerable<TItem>`.
 *
 * ERASURE BEND (generic `GrpcContext<TRequest,TResponse>` collapsed): .NET has a base `GrpcContext` plus a
 * generic `GrpcContext<TRequest,TResponse> : IRequestContext<TRequest>` whose `ResponseAsObject` setter
 * runtime-checks `value is TResponse` to split a typed `Response` from a raw `ResponsePayload`. TypeScript
 * erases `TResponse`, so that runtime split cannot exist; the port keeps a single `GrpcContext` that stores
 * whatever the result setter writes in `responsePayload` (a unary payload or a response `AsyncIterable`),
 * and the serialization adapter / stream adapter converts it to the wire response on the way out. The
 * `IRequestContext<TRequest>` seam is unused by the gRPC getters/mapper (they read `requestAsObject`
 * directly, exactly as in .NET), so nothing depends on the dropped generic.
 */
export class GrpcContext implements IHasMessageResult {
  /** The Benzene topic this call routes to, resolved from the gRPC method path by the route finder. */
  readonly topic: string;

  /**
   * The grpc-js call: inbound metadata, deadline and cancellation state. Typed as the shared
   * {@link GrpcServerCall} surface so one context type serves every RPC shape (the analog of .NET's
   * single `ServerCallContext`). A {@link ServerUnaryCall} — the unary/server-streaming call — is
   * assignable to it.
   */
  readonly call: GrpcServerCall;

  /**
   * The request as the pipeline sees it: the unary request object for unary/server-streaming calls, or
   * the inbound request `AsyncIterable<TItem>` for client-/bidi-streaming calls. Port of C#
   * `RequestAsObject` (which .NET likewise instantiates as `IAsyncEnumerable<TItem>` for the stream-in
   * shapes). Held as a field rather than reflected off `call`, since only the request-carrying shapes
   * expose a `.request`.
   */
  private readonly request: unknown;

  /**
   * Metadata to send back to the client before the first response message. Written by response
   * middleware; empty means no response headers are sent. Port of C# `ResponseHeaders`.
   */
  readonly responseHeaders: Metadata = new Metadata();

  /**
   * The raw handler response payload, set by {@link GrpcMessageHandlerResultSetter} from the
   * `IBenzeneResult.payloadAsObject`. Converted to the wire response type by the message adapter.
   * Port of C# `ResponsePayload`/`ResponseAsObject` (collapsed under erasure — see the class remarks).
   */
  responsePayload?: unknown;

  /**
   * The full routing/handler outcome, set by {@link GrpcMessageHandlerResultSetter}. Read by
   * {@link GrpcMethodHandler} to map the Benzene status onto a grpc status code + `benzene-status`
   * trailer. Port of C# `MessageHandlerResult`. `undefined` until a result is recorded.
   */
  messageHandlerResult?: IMessageHandlerResult;

  /** Pass/fail flag required by {@link IHasMessageResult}; set alongside `messageHandlerResult`. */
  messageResult!: IMessageResult;

  /**
   * @param topic The Benzene topic this call routes to.
   * @param call The grpc-js call (any shape — a {@link ServerUnaryCall} passes as `ServerSurfaceCall`).
   * @param request The request as the pipeline should see it. Omit for a request-carrying call
   *   (unary/server-streaming) to default to `call.request`; pass the request `AsyncIterable` for a
   *   client-/bidi-streaming call, whose call exposes no `.request`.
   */
  constructor(topic: string, call: GrpcServerCall, request?: unknown) {
    this.topic = topic;
    this.call = call;
    // Default to the unary request for the request-carrying shapes (unary/server-streaming), whose call
    // is a ServerUnaryCall/ServerWritableStream with a `.request`; the stream-in shapes pass it explicitly.
    this.request = request ?? (call as { request?: unknown }).request;
  }

  /** The incoming request payload or request stream. Port of C# `RequestAsObject`. */
  get requestAsObject(): unknown {
    return this.request;
  }
}
