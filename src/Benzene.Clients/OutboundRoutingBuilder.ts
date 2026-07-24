import { IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMiddlewarePipeline, IMiddlewarePipelineBuilder } from '@benzene/abstractions-middleware';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { DuplicateOutboundRouteException } from './DuplicateOutboundRouteException';
import { OutboundContext } from './OutboundContext';

/**
 * Builds the topic-keyed outbound routing table: one `IMiddlewarePipeline<OutboundContext>` per topic.
 * Registered via {@link addOutboundRouting}.
 * Port of Benzene.Clients.OutboundRoutingBuilder.
 */
export class OutboundRoutingBuilder {
  private readonly container: IBenzeneServiceContainer;
  private readonly routes: { topic: string; builder: IMiddlewarePipelineBuilder<OutboundContext> }[] = [];

  constructor(container: IBenzeneServiceContainer) {
    this.container = container;
  }

  /**
   * Registers an outbound pipeline for `topic`.
   * @param configure Builds the pipeline - e.g. transport middleware plus cross-cutting concerns.
   */
  route(
    topic: string,
    configure: (builder: IMiddlewarePipelineBuilder<OutboundContext>) => void,
  ): this {
    const builder = new MiddlewarePipelineBuilder<OutboundContext>(this.container);
    configure(builder);
    this.routes.push({ topic, builder });
    return this;
  }

  /**
   * Builds the final topic-keyed routing table.
   * @throws DuplicateOutboundRouteException The same topic was registered more than once.
   */
  build(): Map<string, IMiddlewarePipeline<OutboundContext>> {
    const seen = new Set<string>();
    for (const { topic } of this.routes) {
      if (seen.has(topic)) {
        throw new DuplicateOutboundRouteException(topic);
      }
      seen.add(topic);
    }

    const table = new Map<string, IMiddlewarePipeline<OutboundContext>>();
    for (const { topic, builder } of this.routes) {
      table.set(topic, builder.build());
    }
    return table;
  }
}
