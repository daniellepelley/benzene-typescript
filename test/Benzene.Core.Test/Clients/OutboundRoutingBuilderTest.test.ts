import { describe, expect, it } from 'vitest';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { DuplicateOutboundRouteException, OutboundRoutingBuilder } from '@benzene/clients';

/** Port of test/Benzene.Core.Test/Clients/OutboundRoutingBuilderTest.cs. */

function createBuilder(): OutboundRoutingBuilder {
  return new OutboundRoutingBuilder(new DefaultBenzeneServiceContainer());
}

describe('OutboundRoutingBuilder', () => {
  it('distinct topics return one pipeline per topic', () => {
    const builder = createBuilder();

    builder
      .route('order:create', (pipeline) => pipeline.onRequest(() => {}))
      .route('audit:log', (pipeline) => pipeline.onRequest(() => {}));

    const routes = builder.build();

    expect(routes.size).toBe(2);
    expect(routes.has('order:create')).toBe(true);
    expect(routes.has('audit:log')).toBe(true);
  });

  it('a duplicate topic throws DuplicateOutboundRouteException', () => {
    const builder = createBuilder();

    builder
      .route('order:create', (pipeline) => pipeline.onRequest(() => {}))
      .route('order:create', (pipeline) => pipeline.onRequest(() => {}));

    expect(() => builder.build()).toThrow(DuplicateOutboundRouteException);
    try {
      builder.build();
    } catch (error) {
      expect((error as DuplicateOutboundRouteException).topic).toBe('order:create');
    }
  });

  it('no routes returns an empty table', () => {
    expect(createBuilder().build().size).toBe(0);
  });
});
