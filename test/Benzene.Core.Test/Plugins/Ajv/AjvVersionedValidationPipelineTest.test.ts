import { describe, expect, it } from 'vitest';
import { IBenzeneResultOf } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneResult, BenzeneResultStatus } from '@benzenejs/results';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  message,
  MessageHandlersRegistry,
  useMessageHandlersWithRouter,
} from '@benzenejs/core-message-handlers';
import { registerJsonSchema, useAjvValidation } from '@benzenejs/ajv';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';

/**
 * The version-aware half of ajv validation (the port of .NET #69's "validate the DECLARED version's
 * schema" plus #98's getter-layer version join): a topic with two registered handler versions, each
 * with its own request class and JSON Schema. A message declaring a version via the `benzene-version`
 * header must route to THAT version's handler and validate against THAT version's schema — the
 * declared version's schema selection falls out of the version-aware getter (the router routes on the
 * joined topic, and the handler-level validation middleware validates the routed handler's request
 * type), which is exactly the architecture's answer to .NET's topic-keyed schema provider taking an
 * `IMessageVersionGetter`.
 *
 * KEEPS the standing .NET `[DECISION]`: an unknown requested version silently falls back to the max
 * available version (`VersionSelector`) — documented behavior, not a bug.
 */

const Topic = 'ajv-versioned-order';

class OrderV1 {
  quantity: number | undefined;
}

class OrderV2 {
  amount: number | undefined;
}

class OrderResponse {
  handledBy: string | undefined;
}

// Two versions, two shapes: V1 requires an integer quantity; V2 requires a number amount.
registerJsonSchema(OrderV1, {
  type: 'object',
  properties: { quantity: { type: 'integer' } },
  required: ['quantity'],
});
registerJsonSchema(OrderV2, {
  type: 'object',
  properties: { amount: { type: 'number' } },
  required: ['amount'],
});

const registry = new MessageHandlersRegistry();

@message(Topic, { registry, version: 'V1', requestType: OrderV1, responseType: OrderResponse })
class OrderV1Handler implements IMessageHandler<OrderV1, OrderResponse> {
  handleAsync(_request: OrderV1): Promise<IBenzeneResultOf<OrderResponse>> {
    const payload = new OrderResponse();
    payload.handledBy = 'V1';
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

@message(Topic, { registry, version: 'V2', requestType: OrderV2, responseType: OrderResponse })
class OrderV2Handler implements IMessageHandler<OrderV2, OrderResponse> {
  handleAsync(_request: OrderV2): Promise<IBenzeneResultOf<OrderResponse>> {
    const payload = new OrderResponse();
    payload.handledBy = 'V2';
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildApplication(): {
  app: BenzeneMessageApplication;
  container: DefaultBenzeneServiceContainer;
} {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlersWithRouter(builder, (x) => useAjvValidation(x), OrderV1Handler, OrderV2Handler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

async function send(headers: Record<string, string>, body: unknown) {
  const { app, container } = buildApplication();
  const request = new BenzeneMessageRequest();
  request.topic = Topic;
  request.headers = headers;
  request.body = JSON.stringify(body);
  return app.handleAsync(request, container.createServiceResolverFactory());
}

describe('AjvVersionedValidationPipelineTest', () => {
  it('DeclaredVersionRoutesToThatVersionsHandler_AndValidatesItsSchema', async () => {
    // Valid against V1's schema, declared via the benzene-version header (which only the version
    // getter reads — the raw envelope topic carries no version).
    const response = await send({ 'benzene-version': 'V1' }, { quantity: 5 });

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('V1');
  });

  it('DeclaredVersionsSchemaRejectsAPayloadOfTheOtherVersionsShape', async () => {
    // A V2-shaped payload declaring V1: without the getter-layer version join, the lookup would fall
    // back to the max version (V2) and this would wrongly validate green against V2's schema.
    const response = await send({ 'benzene-version': 'V1' }, { amount: 12.5 });

    expect(response.statusCode).toBe(BenzeneResultStatus.validationError);
    expect(response.body).toContain('quantity');
  });

  it('DeclaredV2ValidatesAgainstV2sSchema', async () => {
    const response = await send({ 'benzene-version': 'V2' }, { amount: 12.5 });

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('V2');
  });

  it('UnknownDeclaredVersion_FallsBackToTheMaxVersion', async () => {
    // The standing [DECISION]: an unknown requested version silently falls back to the max available
    // version ('V2' here), so the payload is validated against — and handled by — V2.
    const response = await send({ 'benzene-version': 'V9' }, { amount: 1 });

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('V2');
  });

  it('NoDeclaredVersion_FallsBackToTheMaxVersion', async () => {
    const response = await send({}, { amount: 1 });

    expect(response.statusCode).toBe(BenzeneResultStatus.ok);
    expect(response.body).toContain('V2');
  });
});
