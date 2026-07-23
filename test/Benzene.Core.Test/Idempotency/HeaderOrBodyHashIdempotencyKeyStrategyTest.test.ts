import { describe, expect, it } from 'vitest';
import { ITopic } from '@benzene/abstractions-messages';
import { IMessageBodyGetter, IMessageHeadersGetter } from '@benzene/abstractions-messages';
import { IMessageTopicGetter } from '@benzene/abstractions-message-handlers';
import {
  HeaderOrBodyHashIdempotencyKeyStrategy,
  IdempotencyOptions,
} from '@benzene/idempotency';

/** Port of test/Benzene.Core.Test/Idempotency/HeaderOrBodyHashIdempotencyKeyStrategyTest.cs. */

interface Ctx {
  headers: Record<string, string>;
  body?: string;
  topic?: ITopic;
}

class Topic implements ITopic {
  constructor(
    readonly id: string,
    readonly version: string,
  ) {}
}

const headersGetter: IMessageHeadersGetter<Ctx> = { getHeaders: (context) => context.headers };
const bodyGetter: IMessageBodyGetter<Ctx> = { getBody: (context) => context.body };
const topicGetter: IMessageTopicGetter<Ctx> = { getTopic: (context) => context.topic };

function strategy(options?: IdempotencyOptions): HeaderOrBodyHashIdempotencyKeyStrategy<Ctx> {
  return new HeaderOrBodyHashIdempotencyKeyStrategy<Ctx>(
    headersGetter,
    bodyGetter,
    topicGetter,
    options ?? new IdempotencyOptions(),
  );
}

function withOptions(mutate: (options: IdempotencyOptions) => void): IdempotencyOptions {
  const options = new IdempotencyOptions();
  mutate(options);
  return options;
}

describe('HeaderOrBodyHashIdempotencyKeyStrategy', () => {
  it('uses the header key when present', () => {
    const ctx: Ctx = { headers: { 'idempotency-key': 'abc-123' } };

    expect(strategy().getKey(ctx)).toBe('abc-123');
  });

  it('uses the header key regardless of header-key casing', () => {
    // Header keys are case-insensitive on read: a canonically-cased "Idempotency-Key" must still be
    // honoured rather than silently falling through to body-hashing.
    const ctx: Ctx = {
      headers: { 'Idempotency-Key': 'abc-123' },
      body: '{"id":1}',
      topic: new Topic('order:create', '1'),
    };

    expect(strategy().getKey(ctx)).toBe('abc-123');
  });

  it('respects the key prefix', () => {
    const ctx: Ctx = { headers: { 'idempotency-key': 'abc-123' } };

    const key = strategy(withOptions((o) => (o.keyPrefix = 'orders:'))).getKey(ctx);

    expect(key).toBe('orders:abc-123');
  });

  it('hashes topic and body when there is no header', () => {
    const ctx: Ctx = { headers: {}, body: '{"id":1}', topic: new Topic('order:create', '1') };

    const key = strategy().getKey(ctx);

    expect(key).toBeDefined();
    expect(key).not.toBe('');
  });

  it('the same topic and body produce the same key', () => {
    const a: Ctx = { headers: {}, body: '{"id":1}', topic: new Topic('order:create', '1') };
    const b: Ctx = { headers: {}, body: '{"id":1}', topic: new Topic('order:create', '1') };

    expect(strategy().getKey(a)).toBe(strategy().getKey(b));
  });

  it('a different body produces a different key', () => {
    const a: Ctx = { headers: {}, body: '{"id":1}', topic: new Topic('order:create', '1') };
    const b: Ctx = { headers: {}, body: '{"id":2}', topic: new Topic('order:create', '1') };

    expect(strategy().getKey(a)).not.toBe(strategy().getKey(b));
  });

  it('returns undefined when there is no header and body hashing is disabled', () => {
    const ctx: Ctx = { headers: {}, body: '{"id":1}', topic: new Topic('order:create', '1') };

    const key = strategy(withOptions((o) => (o.hashBodyWhenNoHeader = false))).getKey(ctx);

    expect(key).toBeUndefined();
  });

  it('distinct topic triples that share a separator-flattening produce different keys', () => {
    // id="order"/version="v2:create" vs id="order:v2"/version="create" must NOT collide, or one is
    // silently dropped as a false duplicate of the other.
    const a: Ctx = { headers: {}, body: '{}', topic: new Topic('order', 'v2:create') };
    const b: Ctx = { headers: {}, body: '{}', topic: new Topic('order:v2', 'create') };

    expect(strategy().getKey(a)).not.toBe(strategy().getKey(b));
  });
});
