import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { PipelineBuilderAction } from '@benzene/abstractions-middleware';
import { BenzeneException } from '@benzene/core';
import { addBenzene, TransportMiddlewarePipeline, TransportNames } from '@benzene/core-message-handlers';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { handleUnaryCall, ServerUnaryCall, status } from '@grpc/grpc-js';
import { addGrpcMessageHandlers } from './DependencyInjectionExtensions';
import { GrpcBenzeneError } from './GrpcBenzeneError';
import { GrpcContext } from './GrpcContext';
import { GrpcMethodHandlerFactory } from './GrpcMethodHandlerFactory';
import { GrpcMethodHandlerFactoryAccessor } from './GrpcMethodHandlerFactoryAccessor';
import { GrpcUnaryResult } from './IGrpcMethodHandler';
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
 * registered directly as the `Server`'s method handler(s). {@link toUnaryHandler} yields a grpc-js
 * `handleUnaryCall` you pass to `server.addService(...)`; {@link dispatchUnary} is the lower-level "given a
 * method path + call, run the pipeline" entry point.
 */
export class GrpcBenzeneBridge {
  constructor(
    private readonly routeFinder: IGrpcRouteFinder,
    private readonly accessor: IGrpcMethodHandlerFactoryAccessor,
  ) {}

  /**
   * Routes a unary call: finds the topic for `methodPath`, creates a {@link GrpcMethodHandler} and runs the
   * pipeline. Resolves to the wire response + trailing `benzene-status` metadata, or rejects with a
   * {@link GrpcBenzeneError} — `UNIMPLEMENTED` when no Benzene handler owns the method (the analog of .NET's
   * interceptor falling through to the native service), otherwise the mapped non-OK status.
   */
  dispatchUnary<TResponse>(
    methodPath: string,
    call: ServerUnaryCall<unknown, TResponse>,
  ): Promise<GrpcUnaryResult<TResponse>> {
    const definition = this.routeFinder.find(methodPath);
    if (definition === undefined) {
      return Promise.reject(
        new GrpcBenzeneError(
          status.UNIMPLEMENTED,
          `No Benzene handler is registered for gRPC method '${methodPath}'.`,
        ),
      );
    }

    const factory = this.accessor.factory;
    if (factory === undefined) {
      return Promise.reject(
        new BenzeneException('No gRPC pipeline has been configured; call useGrpc before handling requests.'),
      );
    }

    return factory.create(definition).handleAsync(call);
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
