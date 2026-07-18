import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
import { registerZodSchema, useZodValidation } from '@benzene/zod';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * End-to-end port of Benzene.Test.Plugins.FluentValidation.FluentValidationPipelineTest (and the
 * retired data-annotations pipeline test): wire the full BenzeneMessage stack with Zod validation in
 * the router and assert a valid payload routes to the handler (Ok) while an over-length payload
 * short-circuits (ValidationError).
 */

const Topic = 'zod-message';

// Port of Benzene.Test.Examples.ExampleRequestPayload (FluentValidation asserts Name.MaximumLength(10)).
class ExampleRequest {
  name: string | undefined;
}

class ExampleResponse {
  greeting: string | undefined;
}

// The Zod schema plays the role of FluentValidation's IValidator<ExampleRequest>.
registerZodSchema(ExampleRequest, z.object({ name: z.string().max(10) }));

// Private registry so decorating the handler does not leak into the global registry used by other
// tests; the handler class is passed explicitly to the pipeline.
const registry = new MessageHandlersRegistry();

@message(Topic, { registry, requestType: ExampleRequest, responseType: ExampleResponse })
class ExampleMessageHandler implements IMessageHandler<ExampleRequest, ExampleResponse> {
  handleAsync(request: ExampleRequest): Promise<IBenzeneResultOf<ExampleResponse>> {
    const payload = new ExampleResponse();
    payload.greeting = `hello ${request.name}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildApplication(): { app: BenzeneMessageApplication; container: DefaultBenzeneServiceContainer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlersWithRouter(builder, (x) => useZodValidation(x), ExampleMessageHandler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

describe('ZodValidationsPipelineTest', () => {
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
