/**
 * Pins the §2.1 JSON-Schema -> TypeScript type mapping (`@benzenejs/codegen-client`'s `typeExpression`)
 * and the ported name-formatting rules. This is the language-neutral half of the generator: two ports
 * reading the same schema must produce equivalent client types.
 */
import { describe, expect, it } from 'vitest';
import {
  camelCase,
  pascalCase,
  toIdentifierSegment,
  TopicMethodName,
  TopicReversedMethodName,
  typeExpression,
} from '@benzenejs/codegen-client';

describe('typeExpression', () => {
  it('maps the §2.1 primitive schemas', () => {
    expect(typeExpression({ type: 'string' })).toBe('string');
    expect(typeExpression({ type: 'string', format: 'date-time' })).toBe('string');
    expect(typeExpression({ type: 'boolean' })).toBe('boolean');
    expect(typeExpression({ type: 'integer' })).toBe('number');
    expect(typeExpression({ type: 'number' })).toBe('number');
  });

  it('maps arrays, including arrays of unions', () => {
    expect(typeExpression({ type: 'array', items: { type: 'string' } })).toBe('string[]');
    expect(typeExpression({ type: 'array', items: { type: ['string', 'null'] } })).toBe('(string | null)[]');
  });

  it('maps nullable unions', () => {
    expect(typeExpression({ type: ['string', 'null'] })).toBe('string | null');
    expect(typeExpression({ type: ['integer', 'null'] })).toBe('number | null');
  });

  it('maps objects to inline types with required/optional members', () => {
    expect(
      typeExpression({
        type: 'object',
        properties: { id: { type: 'string' }, note: { type: 'string' } },
        required: ['id'],
      }),
    ).toBe('{ id: string; note?: string }');
  });

  it('maps string-keyed maps to Record', () => {
    expect(typeExpression({ type: 'object', additionalProperties: { type: 'number' } })).toBe(
      'Record<string, number>',
    );
  });

  it('quotes property names that are not bare identifiers', () => {
    expect(
      typeExpression({ type: 'object', properties: { 'x-trace': { type: 'string' } }, required: ['x-trace'] }),
    ).toBe('{ "x-trace": string }');
  });

  it('maps the unconstrained {} schema and unknown constructs to unknown', () => {
    expect(typeExpression({})).toBe('unknown');
    expect(typeExpression(undefined)).toBe('unknown');
  });

  it('recurses into nested objects and arrays of objects', () => {
    expect(
      typeExpression({
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            items: { type: 'object', properties: { sku: { type: 'string' } }, required: ['sku'] },
          },
        },
        required: ['lines'],
      }),
    ).toBe('{ lines: { sku: string }[] }');
  });
});

describe('name formatting', () => {
  it('applies the C# FormatString rules', () => {
    expect(pascalCase('create')).toBe('Create');
    expect(camelCase('CreateOrder')).toBe('createOrder');
    expect(toIdentifierSegment('order-api')).toBe('Orderapi'); // non-identifier chars removed, first upper
    expect(toIdentifierSegment('2fa')).toBe('_2fa'); // leading digit gets an underscore
  });

  it('derives method-base names from topics (reversed by default)', () => {
    expect(new TopicReversedMethodName().create('order:create')).toBe('CreateOrder');
    expect(new TopicMethodName().create('order:create')).toBe('OrderCreate');
    expect(new TopicReversedMethodName().create('greet')).toBe('Greet');
  });
});
