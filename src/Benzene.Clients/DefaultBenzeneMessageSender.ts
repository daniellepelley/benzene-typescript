import { IBenzeneResultOf, IServiceResolver } from '@benzene/abstractions';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';
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

    // Erasure: TResponse is not observable at runtime, so (unlike the .NET `context.Response is
    // IBenzeneResult<TResponse>` check) the port can only verify the route produced *an* IBenzeneResult,
    // then returns it typed as requested. See OutboundResponseTypeMismatchException.
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
