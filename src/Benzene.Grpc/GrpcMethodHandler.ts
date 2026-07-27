import { Deadline, Metadata, ServerUnaryCall, status } from '@grpc/grpc-js';
import { IServiceResolverFactory } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { GrpcBenzeneError } from './GrpcBenzeneError';
import { GrpcContext } from './GrpcContext';
import { GrpcServerCallAccessor } from './GrpcServerCallAccessor';
import { IGrpcMethodDefinition } from './IGrpcMethodDefinition';
import { GrpcUnaryResult, IGrpcMethodHandler } from './IGrpcMethodHandler';
import { IGrpcStatusCodeMapper } from './IGrpcStatusCodeMapper';
import { IGrpcMessageAdapter } from './Serialization/IGrpcMessageAdapter';

/** The flat trailer carrying the raw Benzene status, alongside the mapped grpc status code. */
const BENZENE_STATUS_TRAILER = 'benzene-status';

/**
 * Port of Benzene.Grpc.GrpcMethodHandler — the heart of the bridge, narrowed to **unary** calls.
 *
 * Runs the shared `IMiddlewarePipeline<GrpcContext>` for one unary call in its own DI scope, then
 * translates the outcome:
 * - a cancelled call → a {@link GrpcBenzeneError} with `CANCELLED` (or `DEADLINE_EXCEEDED` past the
 *   deadline), matching .NET's `OperationCanceledException` → `RpcException` translation;
 * - a non-OK Benzene status → a {@link GrpcBenzeneError} with the mapped grpc code + a `benzene-status`
 *   trailer;
 * - OK → the wire response (via {@link IGrpcMessageAdapter}) plus the `benzene-status` trailer.
 *
 * DEFERRED (documented): the streaming overloads; the rich `google.rpc.Status`/`grpc-status-details-bin`
 * error details (protobuf-only, see README); flushing buffered `responseHeaders` mid-call (grpc-js sends
 * response metadata via `call.sendMetadata`, left to the host wiring).
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

      const response = resolver
        .getService(IGrpcMessageAdapter)
        .convertResponse<TResponse>(grpcContext.responsePayload);
      return { response, trailer };
    } finally {
      resolver.dispose();
    }
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
