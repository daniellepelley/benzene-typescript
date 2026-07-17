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
import { maxLength, required, useDataAnnotationsValidation } from '@benzene/data-annotations';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';

/**
 * End-to-end port of Benzene.Test.Plugins.DataAnnotations.DataAnnotationsValidationsPipelineTest:
 * wire the full BenzeneMessage stack with DataAnnotations validation in the router and assert a valid
 * payload routes to the handler (Ok) while an over-length payload short-circuits (ValidationError).
 */

const Topic = 'data-annotations-message';

// Port of Benzene.Test.Examples.ExampleRequestPayload ([Required] [MaxLength(10)] on Name).
class ExampleRequestPayload {
  @required
  @maxLength(10)
  name: string | undefined;
}

class ExampleResponsePayload {
  greeting: string | undefined;
}

// Private registry so decorating the handler does not leak into the global registry used by other
// tests; the handler class is passed explicitly to the pipeline.
const registry = new MessageHandlersRegistry();

@message(Topic, { registry, requestType: ExampleRequestPayload, responseType: ExampleResponsePayload })
class ExampleMessageHandler implements IMessageHandler<ExampleRequestPayload, ExampleResponsePayload> {
  handleAsync(request: ExampleRequestPayload): Promise<IBenzeneResultOf<ExampleResponsePayload>> {
    const payload = new ExampleResponsePayload();
    payload.greeting = `hello ${request.name}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function buildApplication(): { app: BenzeneMessageApplication; container: DefaultBenzeneServiceContainer } {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlersWithRouter(builder, (x) => useDataAnnotationsValidation(x), ExampleMessageHandler);

  return { app: new BenzeneMessageApplication(builder.build()), container };
}

describe('DataAnnotationsValidationsPipelineTest', () => {
  it.each([
    ['foo', BenzeneResultStatus.ok],
    ['foo-bar-foo-bar', BenzeneResultStatus.validationError],
  ])('ValidationTest name=%s', async (name, expectedStatus) => {
    const { app, container } = buildApplication();

    const payload = new ExampleRequestPayload();
    payload.name = name;

    const request = new BenzeneMessageRequest();
    request.topic = Topic;
    request.body = JSON.stringify(payload);

    const response = await app.handleAsync(request, container.createServiceResolverFactory());

    expect(response).toBeDefined();
    expect(response.statusCode).toBe(expectedStatus);
  });
});
