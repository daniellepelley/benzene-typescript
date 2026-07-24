import { describe, expect, it } from 'vitest';
import { IMessageDefinition } from '@benzene/abstractions-messages';
import {
  CrudConventionResponseEventMapping,
  ExplicitResponseEventMapping,
  IResponseEventMapping,
  PublishFailureMode,
  ResponseEventCatalog,
  ResponseEventDeclarations,
  ResponseEventDefinition,
  ResponseEventMappings,
} from '@benzene/response-events';

/** Port of test/Benzene.Core.Test/ResponseEvents/ResponseEventCatalogTest.cs. */

class OrderCreatedEvent {}
class InvoiceSubmittedEvent {}

function mappings(list: IResponseEventMapping[], mode = PublishFailureMode.FailMessage): ResponseEventMappings {
  return new ResponseEventMappings(list, mode);
}

describe('ResponseEventCatalog', () => {
  it('aggregates mappings across pipelines', () => {
    const sqsPipeline = mappings([new ExplicitResponseEventMapping('order:create', 'order:created', OrderCreatedEvent)]);
    const serviceBusPipeline = mappings(
      [new ExplicitResponseEventMapping('invoice:submit', 'invoice:submitted'), new CrudConventionResponseEventMapping()],
      PublishFailureMode.LogAndContinue,
    );

    const catalog = new ResponseEventCatalog([sqsPipeline, serviceBusPipeline], []);

    expect(catalog.mappings).toHaveLength(3);
    expect(catalog.mappings.some((x) => x.sourceTopic === 'order:create' && x.eventTopic === 'order:created')).toBe(true);
    expect(catalog.mappings.some((x) => x.sourceTopic === 'invoice:submit')).toBe(true);
    expect(catalog.mappings.some((x) => x instanceof CrudConventionResponseEventMapping)).toBe(true);
  });

  it('findDefinitions returns only mappings with a declared payload type', () => {
    const catalog = new ResponseEventCatalog(
      [
        mappings([
          new ExplicitResponseEventMapping('order:create', 'order:created', OrderCreatedEvent),
          new ExplicitResponseEventMapping('invoice:submit', 'invoice:submitted'),
          new CrudConventionResponseEventMapping(),
        ]),
      ],
      [],
    );

    const definitions = catalog.findDefinitions();

    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.topic.id).toBe('order:created');
    expect(definitions[0]!.requestType).toBe(OrderCreatedEvent);
  });

  it('findDefinitions includes declaration-only definitions', () => {
    const declarations = new ResponseEventDeclarations([new ResponseEventDefinition('invoice:submitted', InvoiceSubmittedEvent)]);
    const catalog = new ResponseEventCatalog(
      [mappings([new ExplicitResponseEventMapping('order:create', 'order:created', OrderCreatedEvent)])],
      [declarations],
    );

    const definitions = catalog.findDefinitions();

    expect(definitions).toHaveLength(2);
    expect(definitions.some((x: IMessageDefinition) => x.topic.id === 'order:created' && x.requestType === OrderCreatedEvent)).toBe(true);
    expect(definitions.some((x: IMessageDefinition) => x.topic.id === 'invoice:submitted' && x.requestType === InvoiceSubmittedEvent)).toBe(true);
    expect([...catalog.declaredDefinitions]).toEqual([...declarations.definitions]);
  });

  it('mappings describe themselves', () => {
    const typed = new ExplicitResponseEventMapping('order:create', 'order:created', OrderCreatedEvent);
    const conditional = new ExplicitResponseEventMapping('invoice:submit', 'invoice:submitted', undefined, () => true);

    expect(typed.description).toBe('order:create -> order:created (OrderCreatedEvent)');
    expect(conditional.description).toBe('invoice:submit -> invoice:submitted [conditional]');
    expect(new CrudConventionResponseEventMapping().description).not.toBe('');
  });
});
