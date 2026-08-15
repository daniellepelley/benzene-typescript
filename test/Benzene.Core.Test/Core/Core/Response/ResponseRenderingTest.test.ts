import { describe, expect, it } from 'vitest';
import { IServiceResolver } from '@benzenejs/abstractions';
import {
  IBenzeneResponseAdapter,
  IMessageHandlerDefinition,
} from '@benzenejs/abstractions-message-handlers';
import { BenzeneResult, BenzeneResultStatus, ProblemTypes } from '@benzenejs/results';
import {
  DefaultResponsePayloadMapper,
  JsonMediaFormat,
  JsonSerializer,
  MediaFormatNegotiator,
  MessageHandlerResult,
  RendererResponseHandler,
  ResponseHandlerContainer,
  SerializerResponseRenderer,
} from '@benzenejs/core-message-handlers';
import { Topic } from '@benzenejs/core-messages';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * Response-writing chain test (ported spirit of
 * Benzene.Test.Core.Core.Response.ResponseHandlerContainerTest, whose BenzeneMessage transport wiring
 * is not ported yet, so an in-memory adapter/context stands in).
 */
class TestContext {}

class FakeResponseAdapter implements IBenzeneResponseAdapter<TestContext> {
  body = '';
  contentType: string | undefined;
  statusCode: string | undefined;
  headers: Record<string, string> = {};
  finalized = false;

  setResponseHeader(_context: TestContext, headerKey: string, headerValue: string): void {
    this.headers[headerKey] = headerValue;
  }
  setContentType(_context: TestContext, contentType: string): void {
    this.contentType = contentType;
  }
  setStatusCode(_context: TestContext, statusCode: string): void {
    this.statusCode = statusCode;
  }
  setBody(_context: TestContext, body: string | Uint8Array): void {
    this.body = typeof body === 'string' ? body : new TextDecoder().decode(body);
  }
  getBody(): string {
    return this.body;
  }
  finalizeAsync(): Promise<void> {
    this.finalized = true;
    return Promise.resolve();
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
  return new DefaultBenzeneServiceContainer().createServiceResolverFactory().createScope();
}

function createRenderer(resolver: IServiceResolver): SerializerResponseRenderer<TestContext> {
  const negotiator = new MediaFormatNegotiator<TestContext>(
    [],
    new JsonMediaFormat<TestContext>(new JsonSerializer()),
    resolver,
  );
  return new SerializerResponseRenderer<TestContext>(
    new DefaultResponsePayloadMapper<TestContext>(),
    negotiator,
    resolver,
  );
}

describe('ResponseRenderingTest', () => {
  it('RendererResponseHandler_RendersSuccessPayloadAsJson', async () => {
    const resolver = createResolver();
    const adapter = new FakeResponseAdapter();
    const handler = new RendererResponseHandler<TestContext>(adapter, [createRenderer(resolver)], resolver);

    const payload = new OrderCreated();
    payload.reference = 'ref-42';
    const result = new MessageHandlerResult(new Topic('create-order'), fakeDefinition, BenzeneResult.ok(payload));

    await handler.handleAsync(new TestContext(), result);

    expect(adapter.body).toBe(new JsonSerializer().serialize(payload));
    expect(adapter.contentType).toBe('application/json');
  });

  it('RendererResponseHandler_ShortCircuits_WhenBodyAlreadySet', async () => {
    const resolver = createResolver();
    const adapter = new FakeResponseAdapter();
    adapter.body = 'already-written';
    const handler = new RendererResponseHandler<TestContext>(adapter, [createRenderer(resolver)], resolver);

    const result = new MessageHandlerResult(
      new Topic('create-order'),
      fakeDefinition,
      BenzeneResult.ok(new OrderCreated()),
    );

    await handler.handleAsync(new TestContext(), result);

    expect(adapter.body).toBe('already-written');
    expect(adapter.contentType).toBeUndefined();
  });

  it('SerializerResponseRenderer_RendersProblemDocument_ForFailedResult', async () => {
    const resolver = createResolver();
    const adapter = new FakeResponseAdapter();
    const renderer = createRenderer(resolver);

    const result = new MessageHandlerResult(
      new Topic('create-order'),
      fakeDefinition,
      BenzeneResult.notFound('order missing'),
    );

    await renderer.renderAsync(new TestContext(), result, adapter);

    // An RFC 9457 problem document (wire-contracts.md §1.3), not the pre-RFC-9457 `ErrorPayload`:
    // the Benzene status now travels as `benzeneStatus`, since RFC 9457 defines `status` as the
    // integer HTTP code - and there is no HTTP response here, so `status` is absent entirely.
    const errorBody = JSON.parse(adapter.body) as {
      type: string;
      title: string;
      benzeneStatus: string;
      detail: string;
      errors: { message: string }[];
      status?: unknown;
    };
    expect(errorBody.benzeneStatus).toBe(BenzeneResultStatus.notFound);
    expect(errorBody.type).toBe(ProblemTypes.notFound);
    expect(errorBody.title).toBe('Not found');
    expect(errorBody.detail).toBe('order missing');
    expect(errorBody.errors).toEqual([{ message: 'order missing' }]);
    expect('status' in errorBody).toBe(false);
    expect(adapter.contentType).toBe('application/json');
  });

  it('ResponseHandlerContainer_RunsHandlersThenFinalizes', async () => {
    const resolver = createResolver();
    const adapter = new FakeResponseAdapter();
    const rendererHandler = new RendererResponseHandler<TestContext>(
      adapter,
      [createRenderer(resolver)],
      resolver,
    );
    const container = new ResponseHandlerContainer<TestContext>(adapter, [rendererHandler]);

    const payload = new OrderCreated();
    payload.reference = 'ref-7';
    const result = new MessageHandlerResult(new Topic('create-order'), fakeDefinition, BenzeneResult.ok(payload));

    await container.handleAsync(new TestContext(), result);

    expect(adapter.finalized).toBe(true);
    expect(adapter.body).toBe(new JsonSerializer().serialize(payload));
  });
});
