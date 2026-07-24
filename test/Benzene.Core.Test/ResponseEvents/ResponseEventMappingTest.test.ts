import { describe, expect, it } from 'vitest';
import { Topic } from '@benzene/core-messages';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  CrudConventionResponseEventMapping,
  ExplicitResponseEventMapping,
  IResponseEventMapping,
  PublishFailureMode,
  ResponseEventMappings,
} from '@benzene/response-events';

/** Port of test/Benzene.Core.Test/ResponseEvents/ResponseEventMappingTest.cs. */

class OrderPayload {
  id?: string;
}

function order(id?: string): OrderPayload {
  const payload = new OrderPayload();
  payload.id = id;
  return payload;
}

describe('ExplicitResponseEventMapping', () => {
  it('a successful result with a payload publishes', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created');

    const publication = mapping.resolve(new Topic('order:create'), BenzeneResult.created(order('42')));

    expect(publication).toBeDefined();
    expect(publication!.eventTopic).toBe('order:created');
    expect((publication!.payload as OrderPayload).id).toBe('42');
  });

  it('the topic match is case-insensitive', () => {
    const mapping = new ExplicitResponseEventMapping('Order:Create', 'order:created');

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.ok(order()))).toBeDefined();
  });

  it('a different topic does not publish', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created');

    expect(mapping.resolve(new Topic('invoice:create'), BenzeneResult.created(order()))).toBeUndefined();
  });

  it('a failed result does not publish', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created');

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.notFound<OrderPayload>())).toBeUndefined();
  });

  it('a successful result without a payload does not publish', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created');

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.accepted<OrderPayload>())).toBeUndefined();
  });

  it('a when predicate replaces the default status check', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created', undefined, (result) => result.status === BenzeneResultStatus.created);

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.ok(order()))).toBeUndefined();
    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.created(order()))).toBeDefined();
  });

  it('a projector reshapes the payload', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created', undefined, undefined, (payload) => (payload as OrderPayload).id);

    const publication = mapping.resolve(new Topic('order:create'), BenzeneResult.created(order('42')));

    expect(publication).toBeDefined();
    expect(publication!.payload).toBe('42');
  });

  it('a projector returning null does not publish', () => {
    const mapping = new ExplicitResponseEventMapping('order:create', 'order:created', undefined, undefined, () => null);

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.created(order()))).toBeUndefined();
  });
});

describe('CrudConventionResponseEventMapping', () => {
  it.each([
    ['order:create', BenzeneResultStatus.created, 'order:created'],
    ['order:update', BenzeneResultStatus.updated, 'order:updated'],
    ['order:delete', BenzeneResultStatus.deleted, 'order:deleted'],
  ])('a matching verb %s with status %s publishes the past-tense topic', (sourceTopic, status, expectedEventTopic) => {
    const mapping = new CrudConventionResponseEventMapping();

    const publication = mapping.resolve(new Topic(sourceTopic), BenzeneResult.set(status, order(), true));

    expect(publication).toBeDefined();
    expect(publication!.eventTopic).toBe(expectedEventTopic);
  });

  it('a matching verb with the wrong status does not publish', () => {
    const mapping = new CrudConventionResponseEventMapping();

    expect(mapping.resolve(new Topic('order:create'), BenzeneResult.ok(order()))).toBeUndefined();
  });

  it('a non-CRUD verb does not publish', () => {
    const mapping = new CrudConventionResponseEventMapping();

    expect(mapping.resolve(new Topic('order:submit'), BenzeneResult.created(order()))).toBeUndefined();
  });
});

describe('ResponseEventMappings', () => {
  it('every matching mapping publishes', () => {
    const mappings = new ResponseEventMappings(
      [
        new ExplicitResponseEventMapping('order:create', 'order:created'),
        new ExplicitResponseEventMapping('order:create', 'audit:order-created'),
        new ExplicitResponseEventMapping('invoice:create', 'invoice:created'),
      ],
      PublishFailureMode.FailMessage,
    );

    const publications = mappings.resolve(new Topic('order:create'), BenzeneResult.created(order()));

    expect(publications.map((x) => x.eventTopic)).toEqual(['order:created', 'audit:order-created']);
  });

  it('no match resolves empty', () => {
    const mappings: ResponseEventMappings = new ResponseEventMappings(
      [new ExplicitResponseEventMapping('order:create', 'order:created') as IResponseEventMapping],
      PublishFailureMode.FailMessage,
    );

    expect(mappings.resolve(new Topic('customer:create'), BenzeneResult.created(order()))).toHaveLength(0);
  });
});
