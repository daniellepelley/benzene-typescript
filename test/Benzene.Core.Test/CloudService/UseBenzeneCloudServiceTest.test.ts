import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { IBenzeneResultOf, IBenzeneServiceContainer } from '@benzenejs/abstractions';
import { IMessageHandler } from '@benzenejs/abstractions-message-handlers';
import { IBenzeneApplicationBuilder } from '@benzenejs/abstractions-middleware';
import { BenzeneResult } from '@benzenejs/results';
import { addBenzene, message, MessageHandlersRegistry } from '@benzenejs/core-message-handlers';
import { FuncWrapperMiddleware } from '@benzenejs/core-middleware';
import { BenzeneMessageContext } from '@benzenejs/core-messages';
import { httpEndpoint } from '@benzenejs/http';
import { useAwsLambda } from '@benzenejs/aws-lambda-core';
import { benzeneTestHost, httpBuilder, type BenzeneStartUp } from '@benzenejs/testing';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { useApiGateway } from '@benzenejs/aws-lambda-api-gateway';
import {
  CloudServicePaths,
  CloudServiceProfileReport,
  ICloudServiceBuilder,
  useBenzeneCloudService,
} from '@benzenejs/cloud-service';

/**
 * Port of Benzene.Test.CloudService.UseBenzeneCloudServiceTest. Wires `useBenzeneCloudService` onto a real
 * API Gateway pipeline (via the public `benzeneTestHost` harness) and drives every profile surface over
 * envelope POSTs / HTTP GETs.
 *
 * Divergence from the C# tests: where the C# suite relies on assembly-scanned handlers (the lazy descriptor
 * path), the domain-handler tests here pass the handler explicitly via `withHandlers(...)` — the port's
 * envelope pipeline has its own DI container (generic-erasure isolation), so the shared handler is wired into
 * both surfaces explicitly rather than through a process-global registry.
 */

const domainTopic = 'order:create';
const domainPath = '/orders';

class OrderRequest {
  orderId: string | undefined;
}

class OrderResponse {
  reference: string | undefined;
}

// Private registry: passed explicitly to `withHandlers`, so decorating it does not leak into the global
// registry other tests read.
const registry = new MessageHandlersRegistry();

@httpEndpoint('GET', domainPath)
@message(domainTopic, { registry, requestType: OrderRequest, responseType: OrderResponse })
class ExampleMessageHandler implements IMessageHandler<OrderRequest, OrderResponse> {
  handleAsync(request: OrderRequest): Promise<IBenzeneResultOf<OrderResponse>> {
    const payload = new OrderResponse();
    payload.reference = `ref-${request.orderId ?? 'none'}`;
    return Promise.resolve(BenzeneResult.ok(payload));
  }
}

function createHost(configure?: (cloud: ICloudServiceBuilder) => void) {
  class StartUp implements BenzeneStartUp {
    configureServices(services: IBenzeneServiceContainer): void {
      addBenzene(services);
    }

    configure(app: IBenzeneApplicationBuilder): void {
      useAwsLambda(app, (aws) => useApiGateway(aws, (api) => useBenzeneCloudService(api, 'orders', configure)));
    }
  }

  return benzeneTestHost(StartUp).buildAwsLambdaHost();
}

function createEnvelope(topic: string, body = '{}') {
  return { topic, headers: {}, body };
}

async function postEnvelope(
  host: ReturnType<typeof createHost>,
  path: string,
  topic: string,
  body = '{}',
): Promise<APIGatewayProxyResult> {
  return host.sendEventAsync<APIGatewayProxyResult>(
    asApiGatewayRequest(httpBuilder('POST', path, createEnvelope(topic, body))),
  );
}

describe('useBenzeneCloudService', () => {
  it('serves the envelope endpoint at the default standard path', async () => {
    const host = createHost((cloud) => cloud.withHandlers(ExampleMessageHandler));

    const response = await postEnvelope(host, CloudServicePaths.invoke, domainTopic);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"statusCode":"ok"');
  });

  it('serves the health endpoint at the default standard path', async () => {
    const host = createHost();

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.health)),
    );

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('isHealthy');
  });

  it('serves the spec endpoint at the default standard path', async () => {
    const host = createHost();

    const response = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.spec)),
    );

    expect(response.statusCode).toBe(200);
  });

  it('intercepts the health-check topic on the envelope pipeline', async () => {
    const host = createHost();

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:healthcheck');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('isHealthy');
  });

  it('serves the descriptor on the mesh topic, with the profile self-assessment', async () => {
    const host = createHost();

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('orders');
    expect(response.body).toContain(CloudServiceProfileReport.profileName);
    // No collector configured: the outbound feeds have no destination, so R6 is honestly reported missing.
    expect(response.body).toContain('R6');
  });

  it('declares produces via withProduces (mesh.md §2.3 outbound registration)', async () => {
    const host = createHost((cloud) => cloud.withProduces('payments:capture'));

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('produces');
    expect(response.body).toContain('payments:capture');
    // produces is no longer degraded once the service declares at least one outbound registration.
    expect(response.body).not.toContain('outbound-registry');
  });

  it('withConsumes still works as a deprecated alias for withProduces', async () => {
    // The rename is source-compatible: an existing composition root keeps compiling and keeps
    // producing the same descriptor.
    const host = createHost((cloud) => cloud.withConsumes('payments:capture'));

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('produces');
    expect(response.body).toContain('payments:capture');
    expect(response.body).not.toContain('outbound-registry');
  });

  it('degrades produces (not an empty array) when no outbound registration was declared', async () => {
    const host = createHost();

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('outbound-registry');
  });

  it('reports fully conformant with a collector configured', async () => {
    // Port 9 is the discard service — registration fails and is retried, exactly the spec's degradation
    // behaviour: an unreachable collector never affects the service.
    const host = createHost((cloud) => cloud.withCollector('http://localhost:9/benzene/invoke'));

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(CloudServiceProfileReport.profileName);
    expect(response.body).not.toContain('R6');
    expect(response.body).not.toContain('R7');
    expect(response.body).not.toContain('R8');
  });

  it('does not intercept the mesh topic when mesh is declined', async () => {
    const host = createHost((cloud) => cloud.withoutMesh());

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    expect(response.statusCode).not.toBe(200);
  });

  it('keeps a relocated surface working and flags it in the profile self-assessment', async () => {
    const host = createHost((cloud) => cloud.withInvokePath('/custom-invoke'));

    const response = await postEnvelope(host, '/custom-invoke', 'benzene:mesh');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('R7');
  });

  it('routes domain topics on both surfaces', async () => {
    const host = createHost((cloud) => cloud.withHandlers(ExampleMessageHandler));

    const viaEnvelope = await postEnvelope(host, CloudServicePaths.invoke, domainTopic);
    const viaHttp = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', domainPath)),
    );

    expect(viaEnvelope.statusCode).toBe(200);
    expect(viaHttp.statusCode).toBe(200);
  });

  it('derives the descriptor eagerly and starts announcing before any request (withHandlers)', async () => {
    // A real loopback listener standing in for the collector: withHandlers means the descriptor is built at
    // wire-up, so registration should reach the collector even though this test never sends any request to
    // the service itself.
    const { server, port } = await startLoopback();
    try {
      const registerBody = new Promise<string>((resolve) => {
        server.on('request', (req, res) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            res.statusCode = 200;
            res.end();
            resolve(body);
          });
        });
      });

      createHost((cloud) =>
        cloud.withHandlers(ExampleMessageHandler).withCollector(`http://localhost:${port}/benzene/invoke`),
      );

      const received = await Promise.race([
        registerBody,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 10000)),
      ]);
      expect(received).toContain('benzene:mesh:register');
    } finally {
      server.close();
    }
  });

  it('runs withMiddleware inside the envelope pipeline, before the router', async () => {
    const host = createHost((cloud) =>
      cloud.withMiddleware((envelope) =>
        envelope.use(
          () =>
            new FuncWrapperMiddleware<BenzeneMessageContext>('Test', (context, next) => {
              if (context.benzeneMessageRequest.topic !== 'custom-intercept') {
                return next();
              }
              context.benzeneMessageResponse.statusCode = 'ok';
              context.benzeneMessageResponse.body = '{"intercepted":true}';
              return Promise.resolve();
            }),
        ),
      ),
    );

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'custom-intercept');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('intercepted');
  });

  it('evaluates the wiring honestly in the profile report', () => {
    const report = buildReport((cloud) => cloud.withCollector('http://collector/benzene/invoke'));
    expect(report.isConformant).toBe(true);
    expect(report.missing).toEqual([]);

    const noCollector = buildReport();
    expect(noCollector.isConformant).toBe(false);
    expect(noCollector.missing).toEqual(['R6']);

    const withoutMesh = buildReport((cloud) => cloud.withoutMesh());
    expect(withoutMesh.missing).toEqual(['R6', 'R8']);

    const relocated = buildReport((cloud) =>
      cloud.withCollector('http://collector/benzene/invoke').withSpecPath('/spec'),
    );
    expect(relocated.missing).toEqual(['R7']);
  });
});

function buildReport(configure?: (cloud: ICloudServiceBuilder) => void): CloudServiceProfileReport {
  let report: CloudServiceProfileReport | undefined;
  createHost((cloud) => {
    configure?.(cloud);
    cloud.withProfileReport((x) => (report = x));
  });
  return report!;
}

function startLoopback(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, port });
    });
  });
}
