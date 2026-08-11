import { IBenzeneResultOf, ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
import { JsonSerializer } from '@benzene/core-message-handlers';
import { BenzeneMessageClientResponse } from './BenzeneMessageClientResponse';
import { asBenzeneResult } from './Common/ClientResultExtensions';
import { IBenzeneMessageSender } from './IBenzeneMessageSender';
import { OutboundContext } from './OutboundContext';
import { OutboundResponseTypeMismatchException } from './OutboundResponseTypeMismatchException';
import { UnroutedTopicException } from './UnroutedTopicException';

/**
 * The default {@link IBenzeneMessageSender}: resolves a topic to its registered outbound pipeline and
 * runs it. Not exported from the package index (an implementation detail wired by {@link addOutboundRouting}).
 * Port of Benzene.Clients.DefaultBenzeneMessageSender.
 */
export class DefaultBenzeneMessageSender implements IBenzeneMessageSender {
  private readonly routes: ReadonlyMap<string, IMiddlewarePipeline<OutboundContext>>;
  private readonly serviceResolver: IServiceResolver;

  constructor(
    routes: ReadonlyMap<string, IMiddlewarePipeline<OutboundContext>>,
    serviceResolver: IServiceResolver,
  ) {
    this.routes = routes;
    this.serviceResolver = serviceResolver;
  }

  async sendAsync<TRequest, TResponse>(
    topic: string,
    request: TRequest,
    headers?: Record<string, string>,
  ): Promise<IBenzeneResultOf<TResponse>> {
    const pipeline = this.routes.get(topic);
    if (pipeline === undefined) {
      throw new UnroutedTopicException(topic);
    }

    const context = new OutboundContext(topic, request, headers);
    await pipeline.handleAsync(context, this.serviceResolver);

    // A response-bearing transport (in-process; an HTTP message client) leaves a raw envelope; deserialize
    // its body into TResponse here — the one frame that still has TResponse in scope. The body is recovered
    // structurally (JSON.parse + cast); there is no runtime type to validate against.
    if (context.response instanceof BenzeneMessageClientResponse) {
      const serializer = this.serviceResolver.tryGetService(ISerializer) ?? new JsonSerializer();
      return asBenzeneResult<TResponse>(context.response, serializer);
    }

    // A fire-and-forget transport (SQS, SNS, …) set a VoidResult (or any IBenzeneResult) directly. TResponse
    // is not observable at runtime, so the port can only verify the route produced *an* IBenzeneResult and
    // returns it typed as requested. See OutboundResponseTypeMismatchException.
    if (!isBenzeneResult(context.response)) {
      throw new OutboundResponseTypeMismatchException(topic);
    }

    return context.response as IBenzeneResultOf<TResponse>;
  }
}

function isBenzeneResult(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'isSuccessful' in value &&
    'status' in value
  );
}
