import { describe, expect, it } from 'vitest';
import { IRequestEnricher, IRequestMapper } from '@benzene/abstractions-message-handlers';
import { EnrichingRequestMapper } from '@benzene/core-message-handlers';

/** Port of Benzene.Test.Core.Core.MessageHandling.EnrichingRequestMapperTest scenarios. */
class TestContext {}

class TestRequest {
  name: string | undefined;
}

class FixedRequestMapper implements IRequestMapper<TestContext> {
  constructor(private readonly request: unknown) {}
  getBody<TRequest>(): TRequest | undefined {
    return this.request as TRequest | undefined;
  }
}

class TrackingEnricher implements IRequestEnricher<TestContext> {
  wasCalled = false;
  constructor(private readonly values: Record<string, unknown>) {}
  enrich<TRequest>(_request: TRequest, _context: TestContext): Record<string, unknown> {
    this.wasCalled = true;
    return this.values;
  }
}

describe('EnrichingRequestMapperTest', () => {
  it('GetBody_InnerMapperReturnsUndefined_ReturnsUndefinedWithoutCallingEnrichers', () => {
    const enricher = new TrackingEnricher({ name: 'should-not-apply' });
    const mapper = new EnrichingRequestMapper<TestContext>(new FixedRequestMapper(undefined), [enricher]);

    const result = mapper.getBody<TestRequest>(new TestContext());

    expect(result).toBeUndefined();
    expect(enricher.wasCalled).toBe(false);
  });

  it('GetBody_NoEnrichersRegistered_ReturnsMappedRequestUnchanged', () => {
    const request = new TestRequest();
    request.name = 'original';
    const mapper = new EnrichingRequestMapper<TestContext>(new FixedRequestMapper(request), []);

    const result = mapper.getBody<TestRequest>(new TestContext());

    expect(result).toBe(request);
    expect(result?.name).toBe('original');
  });

  it('GetBody_EarlierEnricherTakesPrecedenceOverLater', () => {
    const request = new TestRequest();
    const mapper = new EnrichingRequestMapper<TestContext>(new FixedRequestMapper(request), [
      new TrackingEnricher({ name: 'from-first' }),
      new TrackingEnricher({ name: 'from-second' }),
    ]);

    const result = mapper.getBody<TestRequest>(new TestContext());

    expect(result?.name).toBe('from-first');
  });

  it('GetBody_LaterEnricherFillsPropertyEarlierOneDidNotSet', () => {
    const request = new TestRequest();
    const mapper = new EnrichingRequestMapper<TestContext>(new FixedRequestMapper(request), [
      new TrackingEnricher({}),
      new TrackingEnricher({ name: 'from-second' }),
    ]);

    const result = mapper.getBody<TestRequest>(new TestContext());

    expect(result?.name).toBe('from-second');
  });
});
