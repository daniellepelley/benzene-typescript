import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import { addBenzene, TransportMiddlewarePipeline, TransportNames } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  handleBidiStreamingCall,
  handleClientStreamingCall,
  handleServerStreamingCall,
  handleUnaryCall,
  Metadata,
  ServerDuplexStream,
  ServerReadableStream,
  ServerUnaryCall,
  ServerWritableStream,
  status,
} from '@grpc/grpc-js';
import { addGrpcMessageHandlers } from './DependencyInjectionExtensions';
import { GrpcBenzeneError } from './GrpcBenzeneError';
import { GrpcContext } from './GrpcContext';
import { GrpcMethodHandlerFactory } from './GrpcMethodHandlerFactory';
import { GrpcMethodHandlerFactoryAccessor } from './GrpcMethodHandlerFactoryAccessor';
import { GrpcUnaryResult, IGrpcMethodHandler } from './IGrpcMethodHandler';
import { IGrpcMethodHandlerFactoryAccessor } from './IGrpcMethodHandlerFactoryAccessor';
import { IGrpcRouteFinder } from './IGrpcRouteFinder';

/** Options for {@link useGrpc}. */
export interface BenzeneGrpcOptions {
  /**
   * A pre-built service container to register into (e.g. to share DI with the rest of the app). Defaults
   * to a fresh {@link DefaultBenzeneServiceContainer}.
   */
  container?: IBenzeneServiceContainer;
}

/**
 * The Benzene ⇄ gRPC bridge produced by {@link useGrpc}: dispatches a `@grpc/grpc-js` unary call through
 * the built Benzene pipeline and returns/throws the grpc-shaped outcome.
 *
 * SDK-MODEL BEND: this single object replaces BOTH .NET pieces — the `BenzeneInterceptor` (a
 * `Grpc.Core.Interceptors.Interceptor`) AND the `Benzene.Grpc.AspNet` hosting glue. In Node there is no
 * ASP.NET Core and no interceptor split: the `@grpc/grpc-js` `Server` *is* the host, so the bridge is
 * registered directly as the `Server`'s method handler(s). The `to*Handler` methods yield grpc-js handlers
 * you pass to `server.addService(...)` — one per RPC shape ({@link toUnaryHandler},
 * {@link toServerStreamingHandler}, {@link toClientStreamingHandler}, {@link toBidiStreamingHandler}); the
 * `dispatch*` methods are the lower-level "given a method path + call, run the pipeline" entry points.
 *
 * STREAMING BEND (`IAsyncEnumerable<T>` → grpc-js stream calls): where .NET's `BenzeneInterceptor` overrides
 * `ClientStreamingServerHandler`/`ServerStreamingServerHandler`/`DuplexStreamingServerHandler`, the bridge
 * exposes the three matching grpc-js handler shapes. The response-writing shapes (server-/bidi-streaming)
 * have no callback: on success the bridge `end()`s the call with the trailing metadata; on failure it emits
 * the {@link GrpcBenzeneError} on the call (grpc-js's `ServerWritableStream`/`ServerDuplexStream` translate
 * an emitted `'error'` into the RPC status), the streaming analog of the unary error callback.
 */
export class GrpcBenzeneBridge {
  constructor(
    private readonly routeFinder: IGrpcRouteFinder,
    private readonly accessor: IGrpcMethodHandlerFactoryAccessor,
  ) {}

  /**
   * Resolves the {@link GrpcMethodHandler} that owns `methodPath`, or throws — a {@link GrpcBenzeneError}
   * with `UNIMPLEMENTED` when no Benzene handler owns the method (the analog of .NET's interceptor falling
   * through to the native service), or a {@link BenzeneException} when the pipeline hasn't been configured.
   */
  private resolveHandler(methodPath: string): IGrpcMethodHandler {
    const definition = this.routeFinder.find(methodPath);
    if (definition === undefined) {
      throw new GrpcBenzeneError(
        status.UNIMPLEMENTED,
        `No Benzene handler is registered for gRPC method '${methodPath}'.`,
      );
    }

    const factory = this.accessor.factory;
    if (factory === undefined) {
      throw new BenzeneException(
        'No gRPC pipeline has been configured; call useGrpc before handling requests.',
      );
    }

    return factory.create(definition);
  }

  /**
   * Routes a unary call: finds the topic for `methodPath`, creates a {@link GrpcMethodHandler} and runs the
   * pipeline. Resolves to the wire response + trailing `benzene-status` metadata, or rejects (see
   * {@link resolveHandler} for the routing/config errors, otherwise the mapped non-OK status).
   */
  dispatchUnary<TResponse>(
    methodPath: string,
    call: ServerUnaryCall<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>> {
    let handler: IGrpcMethodHandler;
    try {
      handler = this.resolveHandler(methodPath);
    } catch (error) {
      return Promise.reject(error);
    }

    return handler.handleAsync(call);
  }

  /**
   * Routes a server-streaming call: runs the pipeline for the unary request, then writes every response
   * item to `call`. Resolves to the trailing `benzene-status` metadata (the caller `end()`s the call with
   * it); rejects with a {@link GrpcBenzeneError} on a non-OK status (or a routing/config error).
   */
  async dispatchServerStreaming<TResponse>(
    methodPath: string,
    call: ServerWritableStream<unknown, TResponse>,
  ): Promise<Metadata> {
    return this.resolveHandler(methodPath).serverStreamingAsync<TResponse>(call);
  }

  /**
   * Routes a client-streaming call: presents the inbound request stream as an `AsyncIterable`, runs the
   * pipeline, and resolves to the single wire response + trailing metadata (or rejects as above).
   */
  async dispatchClientStreaming<TResponse>(
    methodPath: string,
    call: ServerReadableStream<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>> {
    return this.resolveHandler(methodPath).clientStreamingAsync<TResponse>(call);
  }

  /**
   * Routes a bidirectional-streaming call: streams requests in and response items out over `call`. Resolves
   * to the trailing `benzene-status` metadata (the caller `end()`s the call with it); rejects as above.
   */
  async dispatchDuplexStreaming<TResponse>(
    methodPath: string,
    call: ServerDuplexStream<unknown, TResponse>,
  ): Promise<Metadata> {
    return this.resolveHandler(methodPath).duplexStreamingAsync<TResponse>(call);
  }

  /**
   * Builds a `@grpc/grpc-js` `handleUnaryCall` for a method, ready to register on the grpc-js `Server`. The
   * method path defaults to the call's own `getPath()`, so one handler can serve a whole service; pass
   * `methodPath` to pin it. On success it invokes the callback with the response and the `benzene-status`
   * trailer; on failure it invokes it with the {@link GrpcBenzeneError} (which is a valid grpc-js error).
   */
  toUnaryHandler<TRequest, TResponse>(methodPath?: string): handleUnaryCall<TRequest, TResponse> {
    return (call, callback) => {
      const path = methodPath ?? call.getPath();
      this.dispatchUnary<TResponse>(path, call).then(
        ({ response, trailer }) => callback(null, response, trailer),
        (error: unknown) => callback(error as GrpcBenzeneError),
      );
    };
  }

  /**
   * Builds a `@grpc/grpc-js` `handleServerStreamingCall` for a method. On success the response items have
   * already been written to the call and the bridge `end()`s it with the `benzene-status` trailer; on
   * failure it emits the {@link GrpcBenzeneError} on the call, which grpc-js turns into the RPC status.
   */
  toServerStreamingHandler<TRequest, TResponse>(
    methodPath?: string,
  ): handleServerStreamingCall<TRequest, TResponse> {
    return (call) => {
      const path = methodPath ?? call.getPath();
      this.dispatchServerStreaming<TResponse>(path, call).then(
        (trailer) => call.end(trailer),
        (error: unknown) => call.emit('error', error),
      );
    };
  }

  /**
   * Builds a `@grpc/grpc-js` `handleClientStreamingCall` for a method. On success it invokes the callback
   * with the single response and the `benzene-status` trailer; on failure it invokes it with the
   * {@link GrpcBenzeneError} — the same callback shape as the unary handler.
   */
  toClientStreamingHandler<TRequest, TResponse>(
    methodPath?: string,
  ): handleClientStreamingCall<TRequest, TResponse> {
    return (call, callback) => {
      const path = methodPath ?? call.getPath();
      this.dispatchClientStreaming<TResponse>(path, call).then(
        ({ response, trailer }) => callback(null, response, trailer),
        (error: unknown) => callback(error as GrpcBenzeneError),
      );
    };
  }

  /**
   * Builds a `@grpc/grpc-js` `handleBidiStreamingCall` for a method. On success the response items have
   * already been written to the call and the bridge `end()`s it with the `benzene-status` trailer; on
   * failure it emits the {@link GrpcBenzeneError} on the call, which grpc-js turns into the RPC status.
   */
  toBidiStreamingHandler<TRequest, TResponse>(
    methodPath?: string,
  ): handleBidiStreamingCall<TRequest, TResponse> {
    return (call) => {
      const path = methodPath ?? call.getPath();
      this.dispatchDuplexStreaming<TResponse>(path, call).then(
        (trailer) => call.end(trailer),
        (error: unknown) => call.emit('error', error),
      );
    };
  }
}

/**
 * Wires Benzene message handlers to gRPC and returns the {@link GrpcBenzeneBridge} the grpc-js `Server`
 * dispatches through. Modeled on `@benzene/express`'s `benzene()`: build a container, register the
 * Benzene + gRPC services, build the pipeline from `configure` (tagging the transport `"grpc"`), then wire
 * the method-handler factory into the accessor and resolve the route finder once.
 *
 * ```ts
 * const bridge = useGrpc((pipeline) => useMessageHandlers(pipeline, EchoHandler));
 * // EchoHandler: @grpcMethod('/pkg.Svc/Echo') @message('echo-topic')
 * server.addService(EchoService, { echo: bridge.toUnaryHandler('/pkg.Svc/Echo') });
 * ```
 */
export function useGrpc(
  configure: PipelineBuilderAction<GrpcContext>,
  options: BenzeneGrpcOptions = {},
): GrpcBenzeneBridge {
  const container = options.container ?? new DefaultBenzeneServiceContainer();
  // NOTE: `addBenzene` + `addGrpcMessageHandlers` only — deliberately NOT `addBenzeneMessage`. Under type
  // erasure the port has a single `IMessageGetter` token, so `addBenzeneMessage`'s `BenzeneMessageGetter`
  // (which reads the topic from a `BenzeneMessageContext.benzeneMessageRequest`) would win over the gRPC
  // getters and every call would route to `<missing>`. The standalone SQS/Service Bus consumer workers
  // wire themselves the same way (`addBenzene` + `addXConsumer`), for the same reason.
  addBenzene(container);
  addGrpcMessageHandlers(container);

  const pipelineBuilder = new MiddlewarePipelineBuilder<GrpcContext>(container);
  configure(pipelineBuilder);
  const pipeline = new TransportMiddlewarePipeline<GrpcContext>(
    TransportNames.Grpc,
    pipelineBuilder.build(),
  );

  const accessor = new GrpcMethodHandlerFactoryAccessor();
  accessor.factory = new GrpcMethodHandlerFactory(container, pipeline);

  // The route table is discovered once and stays stable for the process lifetime, so resolve the finder a
  // single time rather than per call.
  const factory = container.createServiceResolverFactory();
  const routeScope = factory.createScope();
  const routeFinder = routeScope.getService(IGrpcRouteFinder);
  routeScope.dispose();

  return new GrpcBenzeneBridge(routeFinder, accessor);
}
