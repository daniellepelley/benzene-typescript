/** Port of Benzene.Grpc.TestHelpers.TestServerCallContext, adapted to grpc-js. */
import { Deadline, Metadata, ServerUnaryCall } from '@grpc/grpc-js';

/** Options for {@link createServerUnaryCall}; every field is optional and defaults to an empty/idle call. */
export interface FakeServerUnaryCallOptions {
  /** The deserialized request the handler receives as `call.request`. */
  request?: unknown;
  /** The inbound request headers. Defaults to empty {@link Metadata}. */
  metadata?: Metadata;
  /** The gRPC method path (`call.getPath()`). Defaults to `"/benzene.test.TestService/Echo"`. */
  method?: string;
  /** Whether the call is already cancelled (`call.cancelled`). Defaults to `false`. */
  cancelled?: boolean;
  /** The call deadline (`call.getDeadline()`). Defaults to `Infinity` (no deadline). */
  deadline?: Deadline;
}

const DEFAULT_METHOD = '/benzene.test.TestService/Echo';

/**
 * Builds a minimal, hand-rolled grpc-js {@link ServerUnaryCall} for unit tests that drive the Benzene gRPC
 * bridge directly — the analog of C#'s `TestServerCallContext.Create(...)`. Only the members Benzene reads
 * off the call ({@link ServerUnaryCall.request | request}, {@link Metadata | metadata}, `cancelled`,
 * `getDeadline()`, `getPath()`) are populated; anything else is absent and throws if touched (the cast
 * mirrors how the C# helper leaves un-read `ServerCallContext` members unimplemented).
 *
 * ADAPTATION (`ServerCallContext` → `ServerUnaryCall`): .NET's `Grpc.Core.ServerCallContext` is a per-call
 * context distinct from the request message; `@grpc/grpc-js` has no such separate object — the call *is* the
 * context (it carries `request`, `metadata`, `cancelled`, `getDeadline()`, `getPath()`), so this fakes a
 * `ServerUnaryCall` rather than a standalone context. It satisfies the {@link GrpcServerCall} surface
 * `@benzene/grpc` reads, so `new GrpcContext(topic, createServerUnaryCall({ ... }))` drives the whole unary
 * pipeline with no live gRPC server or socket — exactly how every other transport worker is unit-tested.
 *
 * @typeParam TRequest The request message type.
 * @typeParam TResponse The response message type.
 */
export function createServerUnaryCall<TRequest, TResponse>(
  options: FakeServerUnaryCallOptions = {},
): ServerUnaryCall<TRequest, TResponse> {
  const method = options.method ?? DEFAULT_METHOD;
  return {
    request: options.request,
    metadata: options.metadata ?? new Metadata(),
    cancelled: options.cancelled ?? false,
    getDeadline: () => options.deadline ?? Infinity,
    getPath: () => method,
  } as unknown as ServerUnaryCall<TRequest, TResponse>;
}
