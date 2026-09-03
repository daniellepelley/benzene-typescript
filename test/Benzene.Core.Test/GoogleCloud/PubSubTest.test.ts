import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf, IServiceResolver } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IMiddlewarePipeline } from '@benzenejs/abstractions-middleware';
import { Constants } from '@benzenejs/core';
import {
  addBenzene,
  MessageHandlersRegistry,
  MessageResult,
  message,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { BenzeneResult } from '@benzenejs/results';
import type { CloudEvent } from '@google-cloud/functions-framework';
import {
  GooglePubSubFunctionHost,
  GooglePubSubFunctionStartUp,
  MessagePublishedData,
  PubSubContext,
  PubSubMessageBodyGetter,
  PubSubMessageHeadersGetter,
  PubSubMessageProcessingException,
  PubSubMessageTopicGetter,
  PubSubMiddlewareApplication,
  PubSubOptions,
  usePubSub,
} from '@benzenejs/google-cloud-functions-pubsub';

/**
 * End-to-end port of the C# Pub/Sub tests (test/Benzene.Core.Test/Google/*). Pub/Sub delivers exactly
 * one message per invocation, so this is a single-message trigger. Fakes only — no live
 * functions-framework server: a CloudEvent's data (base64 `data` + `attributes`) is built directly and
 * driven through the host / application / getters.
 */

/** Builds a MessagePublishedData with a base64-encoded body, attributes, and message id. */
function createData(options: {
  body?: unknown;
  attributes?: Record<string, string>;
  messageId?: string;
} = {}): MessagePublishedData {
  const { body, attributes, messageId = 'msg-1' } = options;
  return {
    message: {
      messageId,
      data:
        body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8').toString('base64'),
      attributes,
    },
    subscription: 'projects/p/subscriptions/s',
  };
}

/** Wraps a MessagePublishedData in a minimal CloudEvent envelope (only `.data` is read by the host). */
function cloudEvent(data: MessagePublishedData): CloudEvent<MessagePublishedData> {
  return {
    specversion: '1.0',
    id: 'evt-1',
    source: '//pubsub.googleapis.com/projects/p/topics/t',
    type: 'google.cloud.pubsub.topic.v1.messagePublished',
    data,
  } as CloudEvent<MessagePublishedData>;
}

describe('PubSub getters', () => {
  it('PubSubMessageBodyGetter returns the base64-decoded body', () => {
    const data = createData({ body: 'hello' });
    const context = new PubSubContext(data);
    expect(new PubSubMessageBodyGetter().getBody(context)).toBe('"hello"');
  });

  it('PubSubMessageBodyGetter returns empty string when there is no data', () => {
    const context = new PubSubContext(createData());
    expect(new PubSubMessageBodyGetter().getBody(context)).toBe('');
  });

  it('PubSubMessageTopicGetter reads the topic attribute', () => {
    const context = new PubSubContext(createData({ attributes: { topic: 'my-topic' } }));
    expect(new PubSubMessageTopicGetter().getTopic(context)?.id).toBe('my-topic');
  });

  it('PubSubMessageTopicGetter returns <missing> when the topic attribute is absent', () => {
    const context = new PubSubContext(createData());
    expect(new PubSubMessageTopicGetter().getTopic(context)?.id).toBe(Constants.missing);
  });

  it('PubSubMessageTopicGetter reads a custom attribute key when configured', () => {
    const context = new PubSubContext(createData({ attributes: { 'x-my-topic': 'my-topic' } }));
    expect(new PubSubMessageTopicGetter('x-my-topic').getTopic(context)?.id).toBe('my-topic');
  });

  it('PubSubMessageHeadersGetter returns the attributes as headers', () => {
    const context = new PubSubContext(createData({ attributes: { 'correlation-id': 'abc-123' } }));
    expect(new PubSubMessageHeadersGetter().getHeaders(context)['correlation-id']).toBe('abc-123');
  });
});

/** A fake inner pipeline whose handleAsync behaviour the test controls (mirrors the C# Mock pipeline). */
function fakePipeline(
  onHandle: (context: PubSubContext, resolver: IServiceResolver) => void | Promise<void>,
): IMiddlewarePipeline<PubSubContext> {
  return {
    handleAsync: async (context, resolver) => {
      await onHandle(context, resolver);
    },
  };
}

describe('PubSubOptions + PubSubMiddlewareApplication failure handling', () => {
  // A real container so the wrapping TransportMiddlewarePipeline can resolve ISetCurrentTransport.
  function resolverFactory() {
    const container = new DefaultBenzeneServiceContainer();
    addBenzene(container);
    return container.createServiceResolverFactory();
  }

  it('defaults cascade exceptions and escalate failure results', () => {
    const options = new PubSubOptions();
    expect(options.catchExceptions).toBe(false);
    expect(options.raiseOnFailureStatus).toBe(true);
  });

  it('default options + handler throws → exception cascades', async () => {
    const application = new PubSubMiddlewareApplication(
      fakePipeline(() => {
        throw new Error('boom');
      }),
    );
    await expect(application.handleAsync(createData(), resolverFactory())).rejects.toThrow('boom');
  });

  it('catchExceptions true + handler throws → exception is swallowed and logged', async () => {
    const options = new PubSubOptions();
    options.catchExceptions = true;
    const application = new PubSubMiddlewareApplication(
      fakePipeline(() => {
        throw new Error('boom');
      }),
      options,
    );
    // Reaching the end without throwing proves the exception was caught, not cascaded.
    await expect(application.handleAsync(createData(), resolverFactory())).resolves.toBeUndefined();
  });

  it('raiseOnFailureStatus + failure result → throws PubSubMessageProcessingException with the message id', async () => {
    const application = new PubSubMiddlewareApplication(
      fakePipeline((context) => {
        context.messageResult = new MessageResult(false);
      }),
    );
    await expect(
      application.handleAsync(createData({ messageId: 'msg-2' }), resolverFactory()),
    ).rejects.toMatchObject({ messageId: 'msg-2' });
    await expect(
      application.handleAsync(createData({ messageId: 'msg-2' }), resolverFactory()),
    ).rejects.toBeInstanceOf(PubSubMessageProcessingException);
  });

  it('raiseOnFailureStatus + no result recorded → escalates too (null is not success)', async () => {
    // Nothing sets a messageResult — typically an unrouted message. Per benzene-dotnet's
    // work/settlement-consistency-fix-plan.md row 6, a null outcome escalates like a failure:
    // Pub/Sub's ack-deadline redelivery + dead-letter topics are the backstop.
    const application = new PubSubMiddlewareApplication(fakePipeline(() => {}));
    await expect(
      application.handleAsync(createData({ messageId: 'msg-3' }), resolverFactory()),
    ).rejects.toBeInstanceOf(PubSubMessageProcessingException);
  });

  it('raiseOnFailureStatus + handler succeeds → does not throw', async () => {
    const application = new PubSubMiddlewareApplication(
      fakePipeline((context) => {
        context.messageResult = new MessageResult(true);
      }),
    );
    await expect(application.handleAsync(createData(), resolverFactory())).resolves.toBeUndefined();
  });

  it('raiseOnFailureStatus + catchExceptions both true → escalated failure is caught too', async () => {
    const options = new PubSubOptions();
    options.catchExceptions = true;
    const application = new PubSubMiddlewareApplication(
      fakePipeline((context) => {
        context.messageResult = new MessageResult(false);
      }),
      options,
    );
    await expect(application.handleAsync(createData(), resolverFactory())).resolves.toBeUndefined();
  });
});

class PubSubTestRequest {
  name: string | undefined;
}

class PubSubTestResponse {
  greeting: string | undefined;
}

const handled: string[] = [];
const registry = new MessageHandlersRegistry();

@message('pubsub-test-topic', {
  registry,
  requestType: PubSubTestRequest,
  responseType: PubSubTestResponse,
})
class PubSubTestHandler implements IMessageHandler<PubSubTestRequest, PubSubTestResponse> {
  handleAsync(request: PubSubTestRequest): Promise<IBenzeneResultOf<PubSubTestResponse>> {
    handled.push(request.name ?? '<none>');
    const payload = new PubSubTestResponse();
    payload.greeting = `hello ${request.name}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

class PubSubTestStartUp implements GooglePubSubFunctionStartUp {
  configureServices(services: import('@benzenejs/abstractions').IBenzeneServiceContainer): void {
    addBenzene(services);
  }
  configure(app: import('@benzenejs/google-cloud-functions-pubsub').GooglePubSubFunctionApplicationBuilder): void {
    usePubSub(app, (pubsub) => useMessageHandlers(pubsub, PubSubTestHandler));
  }
}

describe('GooglePubSubFunctionHost (end-to-end)', () => {
  it('routes a Pub/Sub CloudEvent through useMessageHandlers to the handler', async () => {
    handled.length = 0;
    const host = new GooglePubSubFunctionHost(PubSubTestStartUp);

    const data = createData({ body: { name: 'world' }, attributes: { topic: 'pubsub-test-topic' } });
    await host.cloudEventFunction(cloudEvent(data));

    expect(handled).toEqual(['world']);
  });

  it('escalates a routing failure (unknown topic) via the default raiseOnFailureStatus', async () => {
    handled.length = 0;
    const host = new GooglePubSubFunctionHost(PubSubTestStartUp);

    const data = createData({ body: { name: 'x' }, attributes: { topic: 'no-such-topic' } });
    await expect(host.handleAsync(cloudEvent(data))).rejects.toBeInstanceOf(
      PubSubMessageProcessingException,
    );
    expect(handled).toEqual([]);
  });

  it('throws when the startup never calls usePubSub', () => {
    class NoPubSubStartUp implements GooglePubSubFunctionStartUp {
      configureServices(): void {}
      configure(): void {}
    }
    expect(() => new GooglePubSubFunctionHost(NoPubSubStartUp)).toThrow('usePubSub');
  });
});
