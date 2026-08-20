import { describe, expect, it } from 'vitest';
import { ISerializer, IServiceResolver } from '@benzenejs/abstractions';
import {
  IBenzeneResponseAdapter,
  IMediaFormat,
  IMessageHandlerDefinition,
} from '@benzenejs/abstractions-message-handlers';
import { IMessageHeadersGetter } from '@benzenejs/abstractions-messages';
import { BenzeneResult } from '@benzenejs/results';
import {
  AcceptHeaderMediaFormatBase,
  DefaultResponsePayloadMapper,
  JsonMediaFormat,
  JsonSerializer,
  MediaFormatNegotiator,
  MessageHandlerResult,
  SerializerResponseRenderer,
} from '@benzenejs/core-message-handlers';
import { Topic } from '@benzenejs/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * Coverage for `SerializerResponseRenderer<TContext>`'s failure-branch content type
 * (wire-contracts.md §4.1): the negotiated format is rewritten to its RFC 9457 "problem"
 * counterpart on a failed result, and left alone on success. This is transport-neutral — it is the
 * media type that changes, not the transport — so it lives in core alongside the renderer.
 * Port of Benzene.Test.Core.Core.Response.SerializerResponseRendererContentTypeTest.
 */
class TestContext {
  headers: Record<string, string> = {};
}

class FakeHeadersGetter implements IMessageHeadersGetter<TestContext> {
  getHeaders(context: TestContext): Record<string, string> {
    return context.headers;
  }
}

class FakeResponseAdapter implements IBenzeneResponseAdapter<TestContext> {
  body = '';
  contentType: string | undefined;

  setResponseHeader(): void {}
  setContentType(_context: TestContext, contentType: string): void {
    this.contentType = contentType;
  }
  setStatusCode(): void {}
  setBody(_context: TestContext, body: string | Uint8Array): void {
    this.body = typeof body === 'string' ? body : new TextDecoder().decode(body);
  }
  getBody(): string {
    return this.body;
  }
  finalizeAsync(): Promise<void> {
    return Promise.resolve();
  }
}

/** Stands in for the XML plugin's format: a concrete `application/xml`, accept-header negotiated. */
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

class OrderCreated {
  reference: string | undefined;
}

const fakeDefinition = {
  topic: new Topic('create-order'),
  requestType: OrderCreated,
  responseType: OrderCreated,
  handlerType: OrderCreated,
} as unknown as IMessageHandlerDefinition;

function createResolver(): IServiceResolver {
  const container = new DefaultBenzeneServiceContainer();
  container.addScopedInstance(IMessageHeadersGetter, new FakeHeadersGetter());
  return container.createServiceResolverFactory().createScope();
}

function createRenderer(): SerializerResponseRenderer<TestContext> {
  const resolver = createResolver();
  const negotiator = new MediaFormatNegotiator<TestContext>(
    [new XmlMediaFormat(new JsonSerializer()) as IMediaFormat<TestContext>],
    new JsonMediaFormat<TestContext>(new JsonSerializer()),
    resolver,
  );
  return new SerializerResponseRenderer<TestContext>(
    new DefaultResponsePayloadMapper<TestContext>(),
    negotiator,
    resolver,
  );
}

function failedResult(): MessageHandlerResult {
  return new MessageHandlerResult(
    new Topic('create-order'),
    fakeDefinition,
    BenzeneResult.notFound('not found'),
  );
}

function successfulResult(): MessageHandlerResult {
  const payload = new OrderCreated();
  payload.reference = 'ref-42';
  return new MessageHandlerResult(new Topic('create-order'), fakeDefinition, BenzeneResult.ok(payload));
}

function xmlContext(): TestContext {
  const context = new TestContext();
  context.headers['accept'] = 'application/xml';
  return context;
}

describe('SerializerResponseRendererContentTypeTest', () => {
  it('FailedResult_JsonNegotiated_ContentTypeIsApplicationProblemJson', async () => {
    const adapter = new FakeResponseAdapter();
    await createRenderer().renderAsync(new TestContext(), failedResult(), adapter);
    expect(adapter.contentType).toBe('application/problem+json');
  });

  it('FailedResult_XmlNegotiated_ContentTypeIsApplicationProblemXml', async () => {
    const adapter = new FakeResponseAdapter();
    await createRenderer().renderAsync(xmlContext(), failedResult(), adapter);
    expect(adapter.contentType).toBe('application/problem+xml');
  });

  it('SuccessfulResult_JsonNegotiated_ContentTypeIsPlainApplicationJson', async () => {
    const adapter = new FakeResponseAdapter();
    await createRenderer().renderAsync(new TestContext(), successfulResult(), adapter);
    expect(adapter.contentType).toBe('application/json');
  });

  it('SuccessfulResult_XmlNegotiated_ContentTypeIsPlainApplicationXml', async () => {
    const adapter = new FakeResponseAdapter();
    await createRenderer().renderAsync(xmlContext(), successfulResult(), adapter);
    expect(adapter.contentType).toBe('application/xml');
  });
});
