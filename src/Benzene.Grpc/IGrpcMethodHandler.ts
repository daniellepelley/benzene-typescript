import {
  Metadata,
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream,
} from '@grpc/grpc-js';

/**
 * The outcome of a successful **unary** or **client-streaming** call (both return a single response): the
 * wire response plus the trailing metadata to send (carrying the `benzene-status` trailer). A non-OK call
 * throws {@link GrpcBenzeneError} instead.
 */
export interface GrpcUnaryResult<TResponse> {
  readonly response: TResponse;
  readonly trailer: Metadata;
}

/**
 * Port of Benzene.Grpc.IGrpcMethodHandler — all four RPC shapes.
 *
 * Each method runs the shared `IMiddlewarePipeline<GrpcContext>` for one call and translates the outcome
 * into the grpc-shaped result (or throws {@link GrpcBenzeneError} on a non-OK status). The two shapes that
 * return a single response ({@link handleAsync}, {@link clientStreamingAsync}) resolve to a
 * {@link GrpcUnaryResult}; the two that write a response stream ({@link serverStreamingAsync},
 * {@link duplexStreamingAsync}) write every response item to the call and resolve to the trailing
 * {@link Metadata} for the caller to `end()` the stream with.
 *
 * STREAMING BEND (`IAsyncEnumerable<T>` → `AsyncIterable<T>`): where .NET takes/returns
 * `IAsyncStreamReader<T>`/`IServerStreamWriter<T>`, the port takes the grpc-js stream calls
 * (`ServerReadableStream`/`ServerWritableStream`/`ServerDuplexStream`) directly and the request/response
 * streams flow as `AsyncIterable<T>` through the pipeline (see `Streaming/GrpcStreamAdapter`).
 */
export interface IGrpcMethodHandler {
  /** Unary: one request in, one response out. */
  handleAsync<TResponse>(
    call: ServerUnaryCall<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>>;

  /**
   * Server-streaming: one request in, a stream of responses out. Writes each response item to `call` and
   * resolves to the trailing metadata to `end()` the call with.
   */
  serverStreamingAsync<TResponse>(
    call: ServerWritableStream<unknown, TResponse>,
  ): Promise<Metadata>;

  /** Client-streaming: a stream of requests in, one response out. */
  clientStreamingAsync<TResponse>(
    call: ServerReadableStream<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>>;

  /**
   * Bidirectional streaming: a stream of requests in, a stream of responses out. Writes each response item
   * to `call` and resolves to the trailing metadata to `end()` the call with.
   */
  duplexStreamingAsync<TResponse>(
    call: ServerDuplexStream<unknown, TResponse>,
  ): Promise<Metadata>;
}
