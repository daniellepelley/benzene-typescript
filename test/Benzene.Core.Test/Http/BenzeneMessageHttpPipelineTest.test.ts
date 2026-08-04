import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzene/abstractions';
import { IMessageHandler } from '@benzene/abstractions-message-handlers';
import { IBenzeneApplicationBuilder } from '@benzene/abstractions-middleware';
import { BenzeneResult } from '@benzene/results';
import {
  addBenzene,
  message,
  MessageHandlersRegistry,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { BenzeneMessageHttpOptions, httpEndpoint, useBenzeneMessage } from '@benzene/http';
import { useAwsLambda } from '@benzene/aws-lambda-core';
import { benzeneTestHost, httpBuilder, type BenzeneStartUp } from '@benzene/testing';
import { asApiGatewayRequest } from '@benzene/aws-lambda-testing';
import { useApiGateway } from '@benzene/aws-lambda-api-gateway';

/**
 * Port of Benzene.Test.Http.BenzeneMessageHttpPipelineTest: wire the BenzeneMessage-over-HTTP endpoint
 * onto a real API Gateway pipeline (via the public `benzeneTestHost` harness, as the ApiGateway pipeline
 * tests do), POST envelopes through it, and assert both the dispatched-envelope round trip and the
 * fall-through to the outer HTTP-routed message handlers.
 */

class ExampleRequest {
  value: string | undefined;
}

class ExampleResponse {
  reference: string | undefined;
}

// A private registry so decorating this handler does not leak into the global registry used by other
// tests; passing the class explicitly to `useMessageHandlers` reads its `@message` metadata directly.
const registry = new MessageHandlersRegistry();

@httpEndpoint('GET', '/example')
@message('example-topic', { registry, requestType: ExampleRequest, responseType: ExampleResponse })
class ExampleHandler implements IMessageHandler<ExampleRequest, ExampleResponse> {
  handleAsync(): Promise<IBenzeneResultOf<ExampleResponse>> {
    const payload = new ExampleResponse();
    payload.reference = 'handled';
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createHost(options?: BenzeneMessageHttpOptions) {
  class StartUp implements BenzeneStartUp {
    configureServices(services: IBenzeneServiceContainer): void {
      addBenzene(services);
    }

    configure(app: IBenzeneApplicationBuilder): void {
      useAwsLambda(app, (aws) =>
        useApiGateway(aws, (api) => {
          useBenzeneMessage(api, options ?? new BenzeneMessageHttpOptions(), (messageApp) =>
            useMessageHandlers(messageApp, ExampleHandler),
          );
          useMessageHandlers(api, ExampleHandler);
        }),
      );
    }
  }

  return benzeneTestHost(StartUp).buildAwsLambdaHost();
}

function createEnvelope(topic: string) {
  return { topic, headers: {}, body: '{}' };
}

describe('BenzeneMessageHttpPipeline', () => {
  it('POST envelope dispatches through the message pipeline', async () => {
    const host = createHost();

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('POST', '/benzene-message', createEnvelope('example-topic'))),
    );

    expect(response).not.toBeNull();
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"statusCode":"ok"');
  });

  it('POST envelope with an unknown topic maps the envelope status to an HTTP status', async () => {
    const host = createHost();

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('POST', '/benzene-message', createEnvelope('no-such-topic'))),
    );

    expect(response).not.toBeNull();
    expect(response.statusCode).not.toBe(200);
  });

  it('POST envelope with a topic rejected by the filter responds not found', async () => {
    const options = new BenzeneMessageHttpOptions();
    options.topicFilter = (topic) => topic !== 'example-topic';
    const host = createHost(options);

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('POST', '/benzene-message', createEnvelope('example-topic'))),
    );

    expect(response).not.toBeNull();
    expect(response.statusCode).toBe(404);
  });

  it('other requests fall through to the HTTP message handlers', async () => {
    const host = createHost();

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', '/example')),
    );

    expect(response).not.toBeNull();
    expect(response.statusCode).toBe(200);
  });
});
