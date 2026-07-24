import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzene/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import {
  registerPayloadSchemaVersions,
  registerSchemaCastDefinitions,
  usePayloadVersionCasting,
} from '@benzene/core-versioning';
import { V1OrderPayload, V2OrderPayload } from './exampleSchemas';

/**
 * Port of test/Benzene.Core.Test/Core/Versioning/PayloadVersionCastingPipelineTest.cs. A single handler
 * written against V2 transparently serves a V1 producer: the request is upcast V1 -> V2 before the
 * handler and the response downcast V2 -> V1 on the way out, wired via `usePayloadVersionCasting` over
 * BenzeneMessage. The auto-mapper is replaced by explicit casts; the V1 -> V2 cast injects the marker
 * `Currency` the C# `RegisterInitValue` did.
 */

const registry = new MessageHandlersRegistry();

@message('order', { registry, requestType: V2OrderPayload, responseType: V2OrderPayload })
class VersioningOrderHandler implements IMessageHandler<V2OrderPayload, V2OrderPayload> {
  handleAsync(request: V2OrderPayload): Promise<IBenzeneResultOf<V2OrderPayload>> {
    // Echo the upcast-injected Currency (only present because the V1->V2 caster ran) into Id, which
    // survives the downcast back to V1 - so the final V1 response Id proves the whole round trip.
    const response = new V2OrderPayload();
    response.id = request.currency;
    response.quantity = request.quantity;
    return Promise.resolve(BenzeneResult.ok(response));
  }
}

function buildApp(): { app: BenzeneMessageApplication; container: DefaultBenzeneServiceContainer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  registerSchemaCastDefinitions(container, (builder) =>
    builder
      .add<V1OrderPayload, V2OrderPayload>(V1OrderPayload, V2OrderPayload, 'order', 'V1', 'V2', (f) => {
        const t = new V2OrderPayload();
        t.id = f.id;
        t.quantity = f.quantity;
        t.currency = 'FROM-UPCAST';
        return t;
      })
      .add<V2OrderPayload, V1OrderPayload>(V2OrderPayload, V1OrderPayload, 'order', 'V2', 'V1', (f) => {
        const t = new V1OrderPayload();
        t.id = f.id;
        t.quantity = f.quantity;
        return t;
      }),
  );
  registerPayloadSchemaVersions(container, [
    { topic: 'order', fromSchemas: ['V1', 'V2'], toSchemas: ['V1', 'V2'] },
  ]);

  const pipeline = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(pipeline, VersioningOrderHandler);
  // After the default mappers are registered (by useMessageHandlers -> addContextItems), so the casting
  // decorators win.
  usePayloadVersionCasting<BenzeneMessageContext>(container);

  return { app: new BenzeneMessageApplication(pipeline.build()), container };
}

function request(topic: string, body: unknown, headers: Record<string, string>): BenzeneMessageRequest {
  const req = new BenzeneMessageRequest();
  req.topic = topic;
  req.headers = headers;
  req.body = JSON.stringify(body);
  return req;
}

describe('PayloadVersionCastingPipeline', () => {
  it('V1Request_IsUpcastForTheHandler_AndResponseDowncastBackToV1', async () => {
    const { app, container } = buildApp();

    const response = await app.handleAsync(
      request('order', { id: 'order-1', quantity: 5, customerName: 'Jo' }, { 'benzene-version': 'V1' }),
      container.createServiceResolverFactory(),
    );

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);

    // Response deserializes as V1, its Id carries the value the V1->V2 upcast injected - proving both
    // request upcast (caster ran, not plain deserialization) and response downcast happened.
    const v1 = JSON.parse(response.body) as V1OrderPayload;
    expect(v1.id).toBe('FROM-UPCAST');
    expect(v1.quantity).toBe(5);

    // The response is V1-shaped: it carries none of V2's Currency field.
    expect(response.body.toLowerCase()).not.toContain('currency');
  });

  it('RequestWithoutVersionHeader_BypassesCasting', async () => {
    const { app, container } = buildApp();

    const response = await app.handleAsync(
      request('order', { id: 'order-2', quantity: 7 }, {}),
      container.createServiceResolverFactory(),
    );

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    const v2 = JSON.parse(response.body) as V2OrderPayload;
    expect(v2.id ?? null).toBeNull();
    expect(v2.quantity).toBe(7);
  });
});
