import {
  Deadline,
  Metadata,
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream,
  status,
} from '@grpc/grpc-js';
import { IServiceResolver, IServiceResolverFactory } from '@benzenejs/abstractions';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { GrpcBenzeneError } from './GrpcBenzeneError';
import { GrpcContext, GrpcServerCall } from './GrpcContext';
import { GrpcServerCallAccessor } from './GrpcServerCallAccessor';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { GrpcUnaryResult, IGrpcMethodHandler } from './IGrpcMethodHandler';
import { IGrpcStatusCodeMapper } from './IGrpcStatusCodeMapper';
import { IGrpcMessageAdapter } from './Serialization/IGrpcMessageAdapter';
import { readAll, tryConvertStream, writeAll } from './Streaming/GrpcStreamAdapter';

/** The flat trailer carrying the raw Benzene status, alongside the mapped grpc status code. */
const BENZENE_STATUS_TRAILER = 'benzene-status';

/**
 * Port of Benzene.Grpc.GrpcMethodHandler — the heart of the bridge, for **all four RPC shapes**.
 *
 * Runs the shared `IMiddlewarePipeline<GrpcContext>` for one call in its own DI scope (via
 * {@link runPipelineAsync}), then translates the outcome:
 * - a cancelled call → a {@link GrpcBenzeneError} with `CANCELLED` (or `DEADLINE_EXCEEDED` past the
 *   deadline), matching .NET's `OperationCanceledException` → `RpcException` translation;
 * - a non-OK Benzene status → a {@link GrpcBenzeneError} with the mapped grpc code + a `benzene-status`
 *   trailer;
 * - OK → the wire response(s) (via {@link IGrpcMessageAdapter} / `GrpcStreamAdapter`) plus the
 *   `benzene-status` trailer.
 *
 * The four entry points differ only in how the request enters and the response leaves the context — the
 * request-carrying shapes ({@link handleAsync}/{@link serverStreamingAsync}) read `call.request`; the
 * stream-in shapes ({@link clientStreamingAsync}/{@link duplexStreamingAsync}) present the inbound stream as
 * an `AsyncIterable`; the stream-out shapes ({@link serverStreamingAsync}/{@link duplexStreamingAsync})
 * pump the handler's response `AsyncIterable` back over the call. One pipeline invocation per call, of any
 * shape — per-item middleware is out of scope by design (per-item concerns belong in the handler).
 *
 * DEFERRED (documented): the rich `google.rpc.Status`/`grpc-status-details-bin` error details (protobuf-
 * only, see README); flushing buffered `responseHeaders` mid-call (grpc-js sends response metadata via
 * `call.sendMetadata`, left to the host wiring).
 */
export class GrpcMethodHandler implements IGrpcMethodHandler {
  private readonly grpcMethodDefinition: IGrpcMethodDefinition;
  private readonly serviceResolverFactory: IServiceResolverFactory;
  private readonly middlewarePipeline: IMiddlewarePipeline<GrpcContext>;

  constructor(
    grpcMethodDefinition: IGrpcMethodDefinition,
    serviceResolverFactory: IServiceResolverFactory,
    middlewarePipeline: IMiddlewarePipeline<GrpcContext>,
  ) {
    this.grpcMethodDefinition = grpcMethodDefinition;
    this.serviceResolverFactory = serviceResolverFactory;
    this.middlewarePipeline = middlewarePipeline;
  }

  async handleAsync<TResponse>(
    call: ServerUnaryCall<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>> {
    const grpcContext = new GrpcContext(this.grpcMethodDefinition.topic, call);
    const resolver = this.serviceResolverFactory.createScope();
    try {
      const trailer = await this.runPipelineAsync(grpcContext, call, resolver);
      const response = resolver
        .getService(IGrpcMessageAdapter)
        .convertResponse<TResponse>(grpcContext.responsePayload);
      return { response, trailer };
    } finally {
      if (resolver.disposeAsync) {
        await resolver.disposeAsync();
      } else {
        resolver.dispose();
      }
    }
  }

  async serverStreamingAsync<TResponse>(
    call: ServerWritableStream<unknown, TResponse>,
  ): Promise<Metadata> {
    // One request in, a stream of responses out: the request is the unary `call.request`.
    const grpcContext = new GrpcContext(this.grpcMethodDefinition.topic, call, call.request);
    const resolver = this.serviceResolverFactory.createScope();
    try {
      const trailer = await this.runPipelineAsync(grpcContext, call, resolver);
      const items = this.resolveResponseStream<TResponse>(grpcContext, resolver);
      await writeAll(items, call);
      return trailer;
    } finally {
      if (resolver.disposeAsync) {
        await resolver.disposeAsync();
      } else {
        resolver.dispose();
      }
    }
  }

  async clientStreamingAsync<TResponse>(
    call: ServerReadableStream<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>> {
    // A stream of requests in, one response out: present the inbound stream as an AsyncIterable request.
    const requestItems = readAll<unknown>(call);
    const grpcContext = new GrpcContext(this.grpcMethodDefinition.topic, call, requestItems);
    const resolver = this.serviceResolverFactory.createScope();
    try {
      const trailer = await this.runPipelineAsync(grpcContext, call, resolver);
      const response = resolver
        .getService(IGrpcMessageAdapter)
        .convertResponse<TResponse>(grpcContext.responsePayload);
      return { response, trailer };
    } finally {
      if (resolver.disposeAsync) {
        await resolver.disposeAsync();
      } else {
        resolver.dispose();
      }
    }
  }

  async duplexStreamingAsync<TResponse>(
    call: ServerDuplexStream<unknown, TResponse>,
  ): Promise<Metadata> {
    // Both sides stream: inbound requests as an AsyncIterable in, handler's response AsyncIterable out.
    const requestItems = readAll<unknown>(call);
    const grpcContext = new GrpcContext(this.grpcMethodDefinition.topic, call, requestItems);
    const resolver = this.serviceResolverFactory.createScope();
    try {
      const trailer = await this.runPipelineAsync(grpcContext, call, resolver);
      const items = this.resolveResponseStream<TResponse>(grpcContext, resolver);
      await writeAll(items, call);
      return trailer;
    } finally {
      if (resolver.disposeAsync) {
        await resolver.disposeAsync();
      } else {
        resolver.dispose();
      }
    }
  }

  /**
   * Runs the middleware pipeline for one gRPC call, regardless of shape: populates the call accessor, runs
   * the pipeline, translates a thrown-on-cancel pipeline into the right {@link GrpcBenzeneError}, and maps
   * the handler's result status onto the `benzene-status` trailer and (for a non-OK result) a thrown
   * {@link GrpcBenzeneError}. On success returns the trailing metadata; the caller extracts/converts the
   * response (or response stream) from `grpcContext` afterwards. Port of .NET's `RunPipelineAsync`.
   */
  private async runPipelineAsync(
    grpcContext: GrpcContext,
    call: GrpcServerCall,
    resolver: IServiceResolver,
  ): Promise<Metadata> {
    const callAccessor = resolver.tryGetService(GrpcServerCallAccessor);
    if (callAccessor !== undefined) {
      callAccessor.call = call;
    }

    try {
      await this.middlewarePipeline.handleAsync(grpcContext, resolver);
    } catch (error) {
      if (call.cancelled) {
        const cancelCode = isPastDeadline(call.getDeadline())
          ? status.DEADLINE_EXCEEDED
          : status.CANCELLED;
        throw new GrpcBenzeneError(cancelCode, 'The call was cancelled.');
      }
      throw error;
    }

    const rawStatus = grpcContext.messageHandlerResult?.benzeneResult.status;
    const trailer = new Metadata();
    trailer.set(BENZENE_STATUS_TRAILER, rawStatus ?? 'Unknown');

    const statusCode = resolver.getService(IGrpcStatusCodeMapper).map(rawStatus);
    if (statusCode !== status.OK) {
      const errors = grpcContext.messageHandlerResult?.benzeneResult.errors;
      const detail =
        errors !== undefined && errors.length > 0 ? errors.join('; ') : (rawStatus ?? 'Error');
      throw new GrpcBenzeneError(statusCode, detail, trailer);
    }

    return trailer;
  }

  /**
   * Extracts the handler's response stream from the context as an `AsyncIterable<TResponse>`: the handler's
   * response payload is a stream, wrapped so each item is converted to the wire type via the message
   * adapter (a no-op with the default structural adapter). Throws `INTERNAL` when the handler produced no
   * stream — port of .NET's `ResolveResponseStream`.
   */
  private resolveResponseStream<TResponse>(
    grpcContext: GrpcContext,
    resolver: IServiceResolver,
  ): AsyncIterable<TResponse> {
    const adapter = resolver.getService(IGrpcMessageAdapter);
    const converted = tryConvertStream(grpcContext.responsePayload, adapter, true);
    if (converted !== undefined) {
      return converted as AsyncIterable<TResponse>;
    }

    throw new GrpcBenzeneError(
      status.INTERNAL,
      'The message handler did not produce a response stream.',
    );
  }
}

/**
 * Whether a grpc-js {@link Deadline} has already passed. Port of C#'s `DateTime.UtcNow >= context.Deadline`
 * (a grpc-js deadline is either an epoch-millis number or a `Date`; `Infinity` means "no deadline").
 */
function isPastDeadline(deadline: Deadline): boolean {
  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
  return Number.isFinite(deadlineMs) && Date.now() >= deadlineMs;
}
