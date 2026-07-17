import { describe, expect, it } from 'vitest';
import { IServiceResolver } from '@benzene/abstractions';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  ContextPredicateBuilder,
  HeaderContextPredicate,
  InlineContextPredicate,
  MediaTypeHeaderContextPredicate,
} from '@benzene/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * Port of Benzene.Test.Core.Core.Predicates.MediaTypeHeaderContextPredicateTest, extended to also
 * cover HeaderContextPredicate, InlineContextPredicate and ContextPredicateBuilder (the C# suite has
 * a dedicated file only for the media-type predicate; the others are exercised here in the same
 * style, since all four ship together).
 */

class TestContext {
  readonly headers: Record<string, string> = {};
}

class TestHeadersGetter implements IMessageHeadersGetter<TestContext> {
  getHeaders(context: TestContext): Record<string, string> {
    return context.headers;
  }
}

function buildResolver(): IServiceResolver {
  const container = new DefaultBenzeneServiceContainer();
  container.addScopedInstance(IMessageHeadersGetter, new TestHeadersGetter());
  return container.createServiceResolverFactory().createScope();
}

describe('ContextPredicateTest', () => {
  describe('MediaTypeHeaderContextPredicate', () => {
    it.each([
      ['application/xml', true],
      ['application/xml; charset=utf-8', true],
      ['APPLICATION/XML', true],
      ['application/json', false],
    ])('Check(%s) matches media type ignoring parameters and case', (headerValue, expected) => {
      const predicate = new MediaTypeHeaderContextPredicate<TestContext>('content-type', 'application/xml');
      const context = new TestContext();
      context.headers['content-type'] = headerValue as string;

      expect(predicate.check(context, buildResolver())).toBe(expected);
    });

    it('Check with missing header returns false', () => {
      const predicate = new MediaTypeHeaderContextPredicate<TestContext>('content-type', 'application/xml');
      expect(predicate.check(new TestContext(), buildResolver())).toBe(false);
    });
  });

  describe('HeaderContextPredicate', () => {
    it('exact equality still applies for the plain HeaderContextPredicate', () => {
      // The base predicate's default comparison is unchanged (exact match) - only
      // MediaTypeHeaderContextPredicate opts into parameter/case-tolerant matching.
      const predicate = new HeaderContextPredicate<TestContext>('content-type', 'application/xml');
      const context = new TestContext();
      context.headers['content-type'] = 'application/xml; charset=utf-8';

      expect(predicate.check(context, buildResolver())).toBe(false);
    });

    it('matches on exact header value', () => {
      const predicate = new HeaderContextPredicate<TestContext>('content-type', 'application/xml');
      const context = new TestContext();
      context.headers['content-type'] = 'application/xml';

      expect(predicate.check(context, buildResolver())).toBe(true);
    });

    it('returns false when the header is absent', () => {
      const predicate = new HeaderContextPredicate<TestContext>('content-type', 'application/xml');
      expect(predicate.check(new TestContext(), buildResolver())).toBe(false);
    });
  });

  describe('InlineContextPredicate', () => {
    it('returns the wrapped function result', () => {
      const context = new TestContext();
      const resolver = buildResolver();

      const truthy = new InlineContextPredicate<TestContext>(() => true);
      const falsy = new InlineContextPredicate<TestContext>(() => false);

      expect(truthy.check(context, resolver)).toBe(true);
      expect(falsy.check(context, resolver)).toBe(false);
    });

    it('passes the context and resolver through to the function', () => {
      const context = new TestContext();
      const resolver = buildResolver();
      let receivedContext: TestContext | undefined;
      let receivedResolver: IServiceResolver | undefined;

      const predicate = new InlineContextPredicate<TestContext>((ctx, res) => {
        receivedContext = ctx;
        receivedResolver = res;
        return true;
      });

      predicate.check(context, resolver);

      expect(receivedContext).toBe(context);
      expect(receivedResolver).toBe(resolver);
    });
  });

  describe('ContextPredicateBuilder', () => {
    it('checkHeader builds a HeaderContextPredicate that matches the configured header', () => {
      const builder = new ContextPredicateBuilder<TestContext>();
      const predicate = builder.checkHeader('content-type', 'application/xml');

      const matching = new TestContext();
      matching.headers['content-type'] = 'application/xml';
      const nonMatching = new TestContext();
      nonMatching.headers['content-type'] = 'application/json';

      expect(predicate.check(matching, buildResolver())).toBe(true);
      expect(predicate.check(nonMatching, buildResolver())).toBe(false);
    });

    it('always builds a predicate that is always true', () => {
      const builder = new ContextPredicateBuilder<TestContext>();
      const predicate = builder.always();

      expect(predicate.check(new TestContext(), buildResolver())).toBe(true);
    });
  });
});
