import { Metadata, ServerUnaryCall } from '@grpc/grpc-js';
import {
  IHasMessageResult,
  IMessageHandlerResult,
  IMessageResult,
} from '@benzene/abstractions-message-handlers';

/**
 * Port of Benzene.Grpc.GrpcContext.
 *
 * The middleware-pipeline context for a single gRPC **unary** call: it carries the grpc-js
 * {@link ServerUnaryCall} (call + inbound {@link Metadata}), the request payload, the buffered
 * response metadata (headers), and — via {@link IHasMessageResult} — the handler's result.
 *
 * SDK-MODEL BEND (`ServerCallContext` → `ServerUnaryCall`): .NET's `Grpc.Core.ServerCallContext` is an
 * abstract per-call context distinct from the request message. `@grpc/grpc-js` instead hands the
 * server handler a single `ServerUnaryCall<TRequest, TResponse>` object that both *is* the call context
 * (`metadata`, `cancelled`, `getDeadline()`, `getPath()`) *and* carries the request (`.request`). So the
 * port folds .NET's `(request, ServerCallContext)` pair into the one `call` — `requestAsObject` reads
 * `call.request`, and the call is also the source for the headers/cancellation accessors.
 *
 * ERASURE BEND (generic `GrpcContext<TRequest,TResponse>` collapsed): .NET has a base `GrpcContext` plus a
 * generic `GrpcContext<TRequest,TResponse> : IRequestContext<TRequest>` whose `ResponseAsObject` setter
 * runtime-checks `value is TResponse` to split a typed `Response` from a raw `ResponsePayload`. TypeScript
 * erases `TResponse`, so that runtime split cannot exist; the port keeps a single `GrpcContext` that stores
 * whatever the result setter writes in `responsePayload`, and the serialization adapter converts it to the
 * wire response type on the way out. The `IRequestContext<TRequest>` seam is unused by the gRPC getters/
 * mapper (they read `requestAsObject` directly, exactly as in .NET), so nothing depends on the dropped
 * generic.
 */
export class GrpcContext implements IHasMessageResult {
  /** The Benzene topic this call routes to, resolved from the gRPC method path by the route finder. */
  readonly topic: string;

  /** The grpc-js unary call: request payload, inbound metadata, deadline and cancellation state. */
  readonly call: ServerUnaryCall<unknown, unknown>;

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

  constructor(topic: string, call: ServerUnaryCall<unknown, unknown>) {
    this.topic = topic;
    this.call = call;
  }

  /** The incoming request payload. Port of C# `RequestAsObject` (here always `call.request`). */
  get requestAsObject(): unknown {
    return this.call.request;
  }
}
