import { VoidResult } from '@benzenejs/abstractions';
import { IBenzeneClientContext } from '@benzenejs/abstractions-messages';
import { IMiddlewarePipelineBuilder, PipelineBuilderAction } from '@benzenejs/abstractions-middleware';
import { IGrpcMessageAdapter, JsonGrpcMessageAdapter } from '@benzenejs/grpc';
import { Client } from '@grpc/grpc-js';
import { GrpcClientMiddleware } from './GrpcClientMiddleware';
import { GrpcContextConverter } from './GrpcContextConverter';
import { GrpcSendMessageContext } from './GrpcSendMessageContext';
import { IGrpcClientRouteRegistry } from './IGrpcClientRouteRegistry';

/**
 * Port of Benzene.Grpc.Client.Extensions (C# fluent extension methods → free functions taking the
 * builder first).
 */

/**
 * Appends the terminal {@link GrpcClientMiddleware} (built from `client`) to a gRPC send pipeline.
 *
 * PORT DIVERGENCE: the C# parameterless `.UseGrpcClient()` overload resolves the `CallInvoker` from the
 * container; the TypeScript port takes the grpc-js `Client` explicitly (there is no synthetic DI token
 * for the raw client), mirroring how `@benzenejs/clients-aws-sqs`'s `useSqsClient` takes the `SQSClient`.
 */
export function useGrpcClient(
  app: IMiddlewarePipelineBuilder<GrpcSendMessageContext>,
  client: Client,
  routeRegistry: IGrpcClientRouteRegistry,
  adapter: IGrpcMessageAdapter = new JsonGrpcMessageAdapter(),
): IMiddlewarePipelineBuilder<GrpcSendMessageContext> {
  return app.use(() => new GrpcClientMiddleware(client, routeRegistry, adapter));
}

/**
 * Converts a Benzene outbound client context to a gRPC send and runs it through the given inner
 * pipeline — the integration point for a client (outbound) pipeline, mirroring the C# `UseGrpc<T>`.
 */
export function useGrpc<T>(
  app: IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>>,
  action: PipelineBuilderAction<GrpcSendMessageContext>,
): IMiddlewarePipelineBuilder<IBenzeneClientContext<T, VoidResult>> {
  return app.convert(new GrpcContextConverter<T>(), action);
}
