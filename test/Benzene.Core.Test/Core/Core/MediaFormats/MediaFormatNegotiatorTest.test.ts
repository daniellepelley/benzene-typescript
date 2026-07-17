import { describe, expect, it } from 'vitest';
import { ISerializer, IServiceResolver } from '@benzene/abstractions';
import { IMediaFormat } from '@benzene/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzene/abstractions-messages';
import {
  AcceptHeaderMediaFormatBase,
  JsonMediaFormat,
  JsonSerializer,
  MediaFormatNegotiator,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/** Port of Benzene.Test.Core.Core.MediaFormats.MediaFormatNegotiatorTest scenarios. */
class TestContext {
  headers: Record<string, string> = {};
}

class FakeHeadersGetter implements IMessageHeadersGetter<TestContext> {
  getHeaders(context: TestContext): Record<string, string> {
    return context.headers;
  }
}

// The Xml plugin isn't ported yet; this stands in as a concrete header-negotiated format
// ("application/xml") so AcceptHeaderMediaFormatBase's content-type/accept matching is exercised.
class XmlMediaFormat extends AcceptHeaderMediaFormatBase<TestContext> {
  constructor(private readonly serializer: ISerializer) {
    super();
  }
  get contentType(): string {
    return 'application/xml';
  }
  getSerializer(): ISerializer {
    return this.serializer;
  }
}

function createResolver(): IServiceResolver {
  const container = new DefaultBenzeneServiceContainer();
  container.addScopedInstance(IMessageHeadersGetter, new FakeHeadersGetter());
  return container.createServiceResolverFactory().createScope();
}

function createNegotiator(...formats: IMediaFormat<TestContext>[]): MediaFormatNegotiator<TestContext> {
  return new MediaFormatNegotiator<TestContext>(
    formats,
    new JsonMediaFormat<TestContext>(new JsonSerializer()),
    createResolver(),
  );
}

function contextWith(contentType?: string, accept?: string): TestContext {
  const context = new TestContext();
  if (contentType !== undefined) context.headers['content-type'] = contentType;
  if (accept !== undefined) context.headers['accept'] = accept;
  return context;
}

// content-type header, accept header, expected read content type, expected write content type
const negotiationCases: ReadonlyArray<[string | undefined, string | undefined, string, string]> = [
  ['application/xml', undefined, 'application/xml', 'application/xml'],
  [undefined, 'application/xml', 'application/json', 'application/xml'],
  ['application/json', 'application/xml', 'application/json', 'application/xml'],
  [undefined, undefined, 'application/json', 'application/json'],
  ['application/xml', 'application/json', 'application/xml', 'application/xml'],
  ['application/xml', 'application/json, application/xml;q=0.9', 'application/xml', 'application/xml'],
];

describe('MediaFormatNegotiatorTest', () => {
  it.each(negotiationCases)(
    'SelectsReadFormat(content-type=%s, accept=%s)',
    (contentType, accept, expectedRead) => {
      const negotiator = createNegotiator(new XmlMediaFormat(new JsonSerializer()));
      expect(negotiator.selectRead(contextWith(contentType, accept)).contentType).toBe(expectedRead);
    },
  );

  it.each(negotiationCases)(
    'SelectsWriteFormat(content-type=%s, accept=%s)',
    (contentType, accept, _expectedRead, expectedWrite) => {
      const negotiator = createNegotiator(new XmlMediaFormat(new JsonSerializer()));
      expect(negotiator.selectWrite(contextWith(contentType, accept)).contentType).toBe(expectedWrite);
    },
  );

  it('NoRegisteredFormats_SelectsDefaultJsonFormat', () => {
    const negotiator = createNegotiator();
    const context = contextWith('application/xml', 'application/xml');

    expect(negotiator.selectRead(context).contentType).toBe('application/json');
    expect(negotiator.selectWrite(context).contentType).toBe('application/json');
  });

  it('SelectRead_IsMemoizedPerNegotiatorInstance', () => {
    const negotiator = createNegotiator(new XmlMediaFormat(new JsonSerializer()));
    const context = contextWith('application/xml');

    const first = negotiator.selectRead(context);
    const second = negotiator.selectRead(context);

    expect(first).toBe(second);
  });
});
