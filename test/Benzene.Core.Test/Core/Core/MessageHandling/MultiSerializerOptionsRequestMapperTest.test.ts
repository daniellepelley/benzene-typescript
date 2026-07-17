import { describe, expect, it } from 'vitest';
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import {
  IMediaFormat,
  IMediaFormatNegotiator,
  IRequestEnricher,
} from '@benzene/abstractions-message-handlers';
import { IMessageBodyGetter } from '@benzene/abstractions-messages';
import {
  JsonMediaFormat,
  JsonSerializer,
  MediaFormatNegotiator,
  MultiSerializerOptionsRequestMapper,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/** Port of Benzene.Test.Core.Core.MessageHandling.MultiSerializerOptionsRequestMapperTest scenarios. */
class TestContext {
  body: string | undefined;
  serializerKind = 'default';
}

class ExampleRequestPayload {
  name: string | undefined;
}

class TestBodyGetter implements IMessageBodyGetter<TestContext> {
  getBody(context: TestContext): string | undefined {
    return context.body;
  }
}

// A serializer whose Deserialize call is observable.
class CountingSerializer implements ISerializer {
  deserializeCallCount = 0;
  serialize<T>(payload: T): string {
    return String(payload);
  }
  deserialize<T>(payload: string): T {
    this.deserializeCallCount++;
    const result = new ExampleRequestPayload();
    result.name = payload;
    return result as unknown as T;
  }
}

// A candidate format applicable when the context's serializerKind matches.
class InlineMediaFormat implements IMediaFormat<TestContext> {
  constructor(
    readonly contentType: string,
    private readonly serializer: ISerializer,
    private readonly canReadPredicate: (context: TestContext) => boolean,
  ) {}
  canRead(context: TestContext): boolean {
    return this.canReadPredicate(context);
  }
  canWrite(context: TestContext): boolean {
    return this.canReadPredicate(context);
  }
  getSerializer(): ISerializer {
    return this.serializer;
  }
}

// Unlike the real MediaFormatNegotiator (scoped/memoizing), this re-evaluates every call so a single
// instance can be reused across multiple simulated messages within one test.
class RoutingMediaFormatNegotiator implements IMediaFormatNegotiator<TestContext> {
  constructor(private readonly formats: IMediaFormat<TestContext>[]) {}
  selectRead(context: TestContext): IMediaFormat<TestContext> {
    return this.formats.find((format) => format.canRead(context, undefined as unknown as IServiceResolver))!;
  }
  selectWrite(context: TestContext): IMediaFormat<TestContext> {
    return this.selectRead(context);
  }
}

function createResolver(): IServiceResolver {
  return new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope();
}

describe('MultiSerializerOptionsRequestMapperTest', () => {
  it('GetBody_NoOptionMatches_UsesDefaultSerializer', () => {
    const resolver = createResolver();
    const negotiator = new MediaFormatNegotiator<TestContext>(
      [],
      new JsonMediaFormat<TestContext>(new JsonSerializer()),
      resolver,
    );

    const mapper = new MultiSerializerOptionsRequestMapper<TestContext>(
      negotiator,
      resolver,
      new TestBodyGetter(),
      [],
    );

    const context = new TestContext();
    context.body = '{"name":"foo"}';
    const result = mapper.getBody<ExampleRequestPayload>(context);

    expect(result?.name).toBe('foo');
  });

  it('GetBody_RepeatedCallsForSameSelectedSerializer_ReuseTheSameUnderlyingSerializer', () => {
    const customSerializer = new CountingSerializer();
    const format = new InlineMediaFormat(
      'application/custom',
      customSerializer,
      (context) => context.serializerKind === 'custom',
    );
    const negotiator = new RoutingMediaFormatNegotiator([format]);

    const mapper = new MultiSerializerOptionsRequestMapper<TestContext>(
      negotiator,
      createResolver(),
      new TestBodyGetter(),
      [] as IRequestEnricher<TestContext>[],
    );

    const context = new TestContext();
    context.serializerKind = 'custom';
    context.body = 'one';

    const first = mapper.getBody<ExampleRequestPayload>(context);
    const second = mapper.getBody<ExampleRequestPayload>(context);

    expect(first?.name).toBe('one');
    expect(second?.name).toBe('one');
    expect(customSerializer.deserializeCallCount).toBe(2);
  });

  it('GetBody_DifferentContextsSelectingDifferentOptions_EachRouteToItsOwnSerializer', () => {
    const firstSerializer = new CountingSerializer();
    const secondSerializer = new CountingSerializer();

    const firstFormat = new InlineMediaFormat(
      'application/first',
      firstSerializer,
      (context) => context.serializerKind === 'first',
    );
    const secondFormat = new InlineMediaFormat(
      'application/second',
      secondSerializer,
      (context) => context.serializerKind === 'second',
    );
    const negotiator = new RoutingMediaFormatNegotiator([firstFormat, secondFormat]);

    const mapper = new MultiSerializerOptionsRequestMapper<TestContext>(
      negotiator,
      createResolver(),
      new TestBodyGetter(),
      [],
    );

    const firstContext = new TestContext();
    firstContext.serializerKind = 'first';
    firstContext.body = 'a';
    const secondContext = new TestContext();
    secondContext.serializerKind = 'second';
    secondContext.body = 'b';

    mapper.getBody<ExampleRequestPayload>(firstContext);
    mapper.getBody<ExampleRequestPayload>(secondContext);

    expect(firstSerializer.deserializeCallCount).toBe(1);
    expect(secondSerializer.deserializeCallCount).toBe(1);
  });
});
