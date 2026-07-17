import { IServiceResolver } from '@benzene/abstractions';
import { ISetCurrentTransport } from '@benzene/abstractions-message-handlers';
import { IMiddlewarePipeline } from '@benzene/abstractions-middleware';

/**
 * Decorates an IMiddlewarePipeline, recording the given transport name via
 * ISetCurrentTransport before delegating to the inner pipeline, so ICurrentTransport
 * reports the right transport for every message that flows through it.
 * Port of Benzene.Core.MessageHandlers.Info.TransportMiddlewarePipeline&lt;TContext&gt;.
 */
export class TransportMiddlewarePipeline<TContext> implements IMiddlewarePipeline<TContext> {
  constructor(
    private readonly transport: string,
    private readonly pipeline: IMiddlewarePipeline<TContext>,
  ) {}

  handleAsync(context: TContext, serviceResolver: IServiceResolver): Promise<void> {
    const setCurrentTransport = serviceResolver.getService(ISetCurrentTransport);
    setCurrentTransport.setTransport(this.transport);
    return this.pipeline.handleAsync(context, serviceResolver);
  }
}
