/**
 * Port of the Benzene.Testing builder scenarios: the platform-neutral request builders
 * (`messageBuilder`/`httpBuilder`) and their `asBenzeneMessage`/`asRawHttpRequest` conversions.
 */
import { describe, expect, it } from 'vitest';
import {
  asBenzeneMessage,
  asRawHttpRequest,
  httpBuilder,
  messageBuilder,
} from '@benzenejs/testing';

describe('messageBuilder', () => {
  it('captures topic, message and fluent headers (last-wins)', () => {
    const builder = messageBuilder('order:create', { orderId: '42' })
      .withHeader('tenant', 'acme')
      .withHeader('tenant', 'beta')
      .withHeaders({ 'x-correlation-id': 'corr-1' });

    expect(builder.topic).toBe('order:create');
    expect(builder.message).toEqual({ orderId: '42' });
    expect(builder.headers).toEqual({ tenant: 'beta', 'x-correlation-id': 'corr-1' });
  });

  it('supports a topic-only message with no body', () => {
    const builder = messageBuilder('ping');
    expect(builder.topic).toBe('ping');
    expect(builder.message).toBeUndefined();
  });
});

describe('asBenzeneMessage', () => {
  it('builds a BenzeneMessageRequest with the serialized body and a copied header map', () => {
    const builder = messageBuilder('order:create', { orderId: '42' }).withHeader('tenant', 'acme');

    const request = asBenzeneMessage(builder);

    expect(request.topic).toBe('order:create');
    expect(request.headers).toEqual({ tenant: 'acme' });
    expect(JSON.parse(request.body)).toEqual({ orderId: '42' });
    // The request holds its own header map, not an alias of the builder's.
    builder.withHeader('added', 'later');
    expect(request.headers).toEqual({ tenant: 'acme' });
  });

  it('honors a custom serializer', () => {
    const request = asBenzeneMessage(messageBuilder('t', { a: 1 }), { serialize: () => 'CUSTOM' });
    expect(request.body).toBe('CUSTOM');
  });
});

describe('httpBuilder / asRawHttpRequest', () => {
  it('renders a raw HTTP/1.1 request with CRLF line endings', () => {
    const builder = httpBuilder('POST', '/orders', { orderId: '42' }).withHeader(
      'content-type',
      'application/json',
    );

    const raw = asRawHttpRequest(builder);

    expect(raw).toBe(
      'POST /orders HTTP/1.1\r\ncontent-type: application/json\r\n\r\n{"orderId":"42"}',
    );
  });
});
