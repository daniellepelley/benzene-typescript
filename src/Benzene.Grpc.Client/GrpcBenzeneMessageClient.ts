import {
  IBenzeneResultOf,
  ILogger,
  IServiceResolver,
  NullLogger,
  VoidResult,
} from '@benzenejs/abstractions';
import { BenzeneClientContext, IBenzeneClientRequest } from '@benzenejs/abstractions-messages';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { IBenzeneMessageClient } from '@benzenejs/clients';
import { IGrpcMessageAdapter, JsonGrpcMessageAdapter } from '@benzenejs/grpc';
import {
  MiddlewarePipelineBuilder,
  NullBenzeneServiceContainer,
  NullServiceResolver,
} from '@benzenejs/core-middleware';
import { BenzeneException } from '@benzenejs/core';
import { BenzeneResult } from '@benzenejs/results';
import { Client, status } from '@grpc/grpc-js';
import { DefaultGrpcStatusReverseMapper } from './DefaultGrpcStatusReverseMapper';
import { GrpcContextConverter } from './GrpcContextConverter';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';
import { IGrpcClientRouteRegistry } from './IGrpcClientRouteRegistry';
import { IGrpcStatusReverseMapper } from './IGrpcStatusReverseMapper';
import { useGrpcClient } from './Extensions';

/**
 * Port of Benzene.Grpc.Client.GrpcBenzeneMessageClient.
 *
 * An {@link IBenzeneMessageClient} that sends outbound unary gRPC calls through a Benzene middleware
 * pipeline, so business logic depends only on the transport-agnostic client surface. `sendMessageAsync`
 * converts the outbound payload, runs the pipeline, converts the raw wire response back to `TResponse`
 * via {@link IGrpcMessageAdapter}, and wraps it in an `IBenzeneResult<TResponse>` via the reverse status
 * mapper (preferring a `benzene-status` trailer). Mirrors {@link KafkaBenzeneMessageClient} /
 * {@link RabbitMqBenzeneMessageClient}.
 *
 * The two C# constructors (`GrpcChannel` / prebuilt pipeline) collapse into one that accepts either a
 * grpc-js {@link Client} (builds the default single-middleware pipeline via {@link useGrpcClient}) or an
 * already-built `IMiddlewarePipeline<GrpcSendMessageContext>` (for testing).
 *
 * BEND (`GrpcChannel`/`channel.CreateCallInvoker()` → caller-supplied grpc-js `Client`): .NET's DI path
 * takes a `GrpcChannel` and derives a `CallInvoker`. The port takes the grpc-js `Client` explicitly (the
 * same caller-owns-the-transport-client shape as the SQS `SQSClient` / Kafka `Producer` / RabbitMQ
 * `Channel`), and calls it via `Client.makeUnaryRequest`.
 *
 * DEFERRED (inbound-deadline / cancellation-token propagation): .NET resolves `IGrpcServerCallAccessor`
 * and `ICancellationTokenAccessor` to forward an inbound gRPC call's deadline + cancellation onto the
 * downstream call. The port's `@benzenejs/grpc` `IGrpcServerCallAccessor` exposes only `call`/`cancelled`
 * (no `Deadline`), there is no `ICancellationTokenAccessor`, and grpc-js `CallOptions` has no cancellation
 * field — so this DI-driven propagation is deferred. A deadline can still be set explicitly via
 * {@link GrpcContextConverter}.
 */
export class GrpcBenzeneMessageClient implements IBenzeneMessageClient {
  private readonly middlewarePipeline: IMiddlewarePipeline<GrpcSendMessageContext>;
  private readonly adapter: IGrpcMessageAdapter;
  private readonly statusReverseMapper: IGrpcStatusReverseMapper;
  private readonly logger: ILogger;
  private readonly serviceResolver: IServiceResolver;

  constructor(
    clientOrPipeline: Client | IMiddlewarePipeline<GrpcSendMessageContext>,
    routeRegistry?: IGrpcClientRouteRegistry,
    adapter: IGrpcMessageAdapter = new JsonGrpcMessageAdapter(),
    statusReverseMapper: IGrpcStatusReverseMapper = new DefaultGrpcStatusReverseMapper(),
    logger: ILogger = NullLogger.instance,
    serviceResolver: IServiceResolver = new NullServiceResolver(),
  ) {
    this.adapter = adapter;
    this.statusReverseMapper = statusReverseMapper;
    this.logger = logger;
    this.serviceResolver = serviceResolver;

    if (isMiddlewarePipeline(clientOrPipeline)) {
      this.middlewarePipeline = clientOrPipeline;
    } else {
      if (routeRegistry === undefined) {
        throw new BenzeneException(
          'A route registry is required to build a gRPC client pipeline from a grpc-js Client.',
        );
      }
      this.middlewarePipeline = useGrpcClient(
        new MiddlewarePipelineBuilder<GrpcSendMessageContext>(new NullBenzeneServiceContainer()),
        clientOrPipeline,
        routeRegistry,
        adapter,
      ).build();
    }
  }

  async sendMessageAsync<TRequest, TResponse>(
    request: IBenzeneClientRequest<TRequest>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    try {
      const converter = new GrpcContextConverter<TRequest>();
      const context = await converter.createRequestAsync(
        new BenzeneClientContext<TRequest, VoidResult>(request),
      );

      await this.middlewarePipeline.handleAsync(context, this.serviceResolver);

      const mappedStatus = this.statusReverseMapper.map(context.status.code, context.responseTrailers);

      if (context.status.code !== status.OK) {
        return context.status.details
          ? BenzeneResult.setErrors<TResponse>(mappedStatus, context.status.details)
          : BenzeneResult.set<TResponse>(mappedStatus);
      }

      const payload = this.adapter.convertRequest<TResponse>(context.response);
      return BenzeneResult.set<TResponse>(mappedStatus, payload);
    } catch (ex) {
      this.logger.logError(ex, `Sending message ${request.topic} failed`);
      return BenzeneResult.serviceUnavailable<TResponse>(ex instanceof Error ? ex.message : String(ex));
    }
  }

  dispose(): void {
    // Intentionally empty — the grpc-js Client/channel lifetime is owned by the caller.
  }
}

function isMiddlewarePipeline(
  value: Client | IMiddlewarePipeline<GrpcSendMessageContext>,
): value is IMiddlewarePipeline<GrpcSendMessageContext> {
  return typeof (value as IMiddlewarePipeline<GrpcSendMessageContext>).handleAsync === 'function';
}
