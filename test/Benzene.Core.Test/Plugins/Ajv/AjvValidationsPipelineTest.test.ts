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
  useMessageHandlersWithRouter,
} from '@benzene/core-message-handlers';
import { registerJsonSchema, useAjvValidation } from '@benzene/ajv';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * End-to-end port of Benzene.Test.Plugins.JsonSchema's pipeline test (mirrors the Zod adapter's
 * `ZodValidationsPipelineTest`): wire the full BenzeneMessage stack with ajv validation in the router and
 * assert a valid payload routes to the handler (Ok) while an over-length payload short-circuits
 * (ValidationError). Because the port validates the deserialized request (not the raw body), the schema is
 * a hand-authored JSON Schema registered against the request class.
 */

const Topic = 'ajv-message';

class ExampleRequest {
  name: string | undefined;
}

class ExampleResponse {
  greeting: string | undefined;
}

// The hand-authored JSON Schema plays the role of Benzene.JsonSchema's supplied schema (Name maxLength 10).
registerJsonSchema(ExampleRequest, {
  type: 'object',
  properties: { name: { type: 'string', maxLength: 10 } },
  required: ['name'],
});

// Private registry so decorating the handler does not leak into the global registry used by other tests.
const registry = new MessageHandlersRegistry();

@message(Topic, { registry, requestType: ExampleRequest, responseType: ExampleResponse })
class ExampleMessageHandler implements IMessageHandler<ExampleRequest, ExampleResponse> {
  handleAsync(request: ExampleRequest): Promise<IBenzeneResultOf<ExampleResponse>> {
    const payload = new ExampleResponse();
    payload.greeting = `hello ${request.name}`;
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
  useMessageHandlersWithRouter(builder, (x) => useAjvValidation(x), ExampleMessageHandler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

describe('AjvValidationsPipelineTest', () => {
  it.each([
    ['foo', BenzeneResultStatus.ok],
    ['foo-bar-foo-bar', BenzeneResultStatus.validationError],
  ])('ValidationTest name=%s', async (name, expectedStatus) => {
    const { app, container } = buildApplication();

    const request = new BenzeneMessageRequest();
    request.topic = Topic;
    request.body = JSON.stringify({ name });

    const response = await app.handleAsync(request, container.createServiceResolverFactory());

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(expectedStatus);
  });
});
