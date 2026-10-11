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
import { MeshOutboundRegistry } from '@benzenejs/mesh-wire';
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
 * Divergence from the C# tests: where the C# suite relies on assembly-scanned handlers, the domain-handler tests here pass the handler explicitly via `withHandlers(...)` — the port's
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

  it('serves the Contract Document on the benzene:spec topic over the envelope, with the profile self-assessment', async () => {
    const host = createHost();

    const document = await specOverEnvelope(host);

    expect(document['schemaDialect']).toBe('openapi-3.0');
    expect(document['service']).toBe('orders');
    expect(document['runtime']).toBe('typescript');
    expect(document['placement']).toEqual({ cloud: 'self-hosted' });
    // No collector configured: the outbound feeds have no destination, so R6 is honestly reported missing.
    expect(document['profile']).toEqual({ name: CloudServiceProfileReport.profileName, missing: ['R6'] });
  });

  it('answers benzene:spec over the envelope with exactly the document GET /benzene/spec serves', async () => {
    const host = createHost((cloud) => cloud.withHandlers(ExampleMessageHandler).withServiceVersion('1.4.2', 'semver'));

    const viaHttp = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.spec)),
    );
    const viaEnvelope = await specOverEnvelope(host);

    expect(viaEnvelope).toEqual(JSON.parse(viaHttp.body));
    expect(viaEnvelope['serviceVersion']).toBe('1.4.2');
    expect(viaEnvelope['versionScheme']).toBe('semver');
    expect((viaEnvelope['requests'] as { topic: string }[]).map((r) => r.topic)).toEqual([domainTopic]);
  });

  it('serves the other spec types over the envelope too (benzene:spec takes { type, format })', async () => {
    const host = createHost();

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:spec', '{"type":"asyncapi"}');

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('asyncapi');
  });

  it('declares a send via withProduces (contract-document.md §3.3)', async () => {
    const host = createHost((cloud) => cloud.withProduces('payments:capture'));

    const document = await specOverEnvelope(host);

    expect((document['sends'] as { topic: string }[]).map((x) => x.topic)).toEqual(['payments:capture']);
    // Declared means complete: neither events nor sends is degraded.
    expect(document['degraded']).toBeUndefined();
  });

  it('withOutbound declares events and sends: the document lists each in its own list', async () => {
    const outbound = new MeshOutboundRegistry()
      .register({ kind: 'event', topic: 'order:placed', message: OrderResponse })
      .register({ kind: 'send', topic: 'payments:capture', request: OrderRequest });
    const host = createHost((cloud) => cloud.withHandlers(ExampleMessageHandler).withOutbound(outbound));

    const spec = await host.sendEventAsync<APIGatewayProxyResult>(
      asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.spec)),
    );
    expect(spec.statusCode).toBe(200);
    const document = JSON.parse(spec.body) as {
      schemaDialect: string;
      service: string;
      requests: { topic: string }[];
      events: { topic: string }[];
      sends: { topic: string }[];
    };
    expect(document.schemaDialect).toBe('openapi-3.0');
    expect(document.service).toBe('orders');
    expect(document.requests.map((r) => r.topic)).toEqual([domainTopic]);
    expect(document.events.map((e) => e.topic)).toEqual(['order:placed']);
    expect(document.sends.map((e) => e.topic)).toEqual(['payments:capture']);
  });

  it('an empty withOutbound asserts "none": events and sends are not degraded', async () => {
    const host = createHost((cloud) => cloud.withOutbound(new MeshOutboundRegistry()));

    const document = await specOverEnvelope(host);

    expect(document['events']).toEqual([]);
    expect(document['sends']).toEqual([]);
    expect(document['degraded']).toBeUndefined();
  });

  it('GET /benzene/spec copies type and format onto the request: an unsupported one is 501', async () => {
    const host = createHost();
    const event = asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.spec));
    event.queryStringParameters = { type: 'conformance-x' };

    const response = await host.sendEventAsync<APIGatewayProxyResult>(event);

    expect(response.statusCode).toBe(501);
  });

  it('withConsumes still works as a deprecated alias for withProduces', async () => {
    // The rename is source-compatible: an existing composition root keeps compiling and keeps declaring the
    // same send.
    const host = createHost((cloud) => cloud.withConsumes('payments:capture'));

    const document = await specOverEnvelope(host);

    expect((document['sends'] as { topic: string }[]).map((x) => x.topic)).toEqual(['payments:capture']);
    expect(document['degraded']).toBeUndefined();
  });

  it('degrades events and sends (unknown, not empty) when no outbound was declared', async () => {
    const host = createHost();

    const document = await specOverEnvelope(host);

    expect(document['degraded']).toEqual(['events', 'sends']);
    expect(document['events']).toEqual([]);
    expect(document['sends']).toEqual([]);
  });

  it('reports fully conformant with a collector configured', async () => {
    // Port 9 is the discard service — registration fails and is retried, exactly the spec's degradation
    // behaviour: an unreachable collector never affects the service.
    const host = createHost((cloud) => cloud.withCollector('http://localhost:9/benzene/invoke'));

    const document = await specOverEnvelope(host);

    expect(document['profile']).toEqual({ name: CloudServiceProfileReport.profileName });
  });

  it('still answers benzene:spec when mesh is declined, reporting R6 and R8 missing', async () => {
    const host = createHost((cloud) => cloud.withoutMesh());

    const document = await specOverEnvelope(host);

    expect(document['profile']).toEqual({ name: CloudServiceProfileReport.profileName, missing: ['R6', 'R8'] });
  });

  it('no longer answers the removed benzene:mesh topic', async () => {
    const host = createHost();

    const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:mesh');

    // Processed envelopes are HTTP 200 whatever their status (D17); no handler claims the topic.
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('"service":"orders"');
  });

  it('keeps a relocated surface working and flags it in the profile self-assessment', async () => {
    const host = createHost((cloud) => cloud.withInvokePath('/custom-invoke'));

    const response = await postEnvelope(host, '/custom-invoke', 'benzene:spec');

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

  it('registers the served Contract Document at boot, then heartbeats with its registrationHash', async () => {
    // A real loopback listener standing in for the collector. The host's start-up hook attaches the host
    // container, so registration reaches the collector even though this test never sends any request to the
    // service itself; the heartbeat follows as soon as the register is acknowledged.
    const { server, port } = await startLoopback();
    try {
      const envelopes: { topic: string; body: string }[] = [];
      const twoEnvelopes = new Promise<void>((resolve) => {
        server.on('request', (req, res) => {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            res.statusCode = 200;
            res.end();
            envelopes.push(JSON.parse(body) as { topic: string; body: string });
            if (envelopes.length === 2) {
              resolve();
            }
          });
        });
      });

      const host = createHost((cloud) =>
        cloud
          .withHandlers(ExampleMessageHandler)
          .withServiceVersion('1.4.2', 'semver')
          .withInstanceId('orders-1')
          .withCollector(`http://localhost:${port}/benzene/invoke`),
      );

      await Promise.race([
        twoEnvelopes,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), 10000)),
      ]);

      const [register, heartbeat] = envelopes;
      expect(register!.topic).toBe('benzene:mesh:register');
      const served = await host.sendEventAsync<APIGatewayProxyResult>(
        asApiGatewayRequest(httpBuilder('GET', CloudServicePaths.spec)),
      );
      // One document, served and registered (mesh.md §2) - byte for byte.
      expect(register!.body).toBe(served.body);
      const document = JSON.parse(register!.body) as Record<string, unknown>;
      expect(document['instanceId']).toBeUndefined(); // instance identity rides heartbeats and traces only

      expect(heartbeat!.topic).toBe('benzene:mesh:heartbeat');
      const beat = JSON.parse(heartbeat!.body) as Record<string, unknown>;
      expect(beat['service']).toBe('orders');
      expect(beat['serviceVersion']).toBe('1.4.2');
      expect(beat['instanceId']).toBe('orders-1');
      expect(beat['registrationHash']).toBe(document['registrationHash']);
      expect(beat['descriptorHash']).toBeUndefined();
      expect(typeof beat['sentAt']).toBe('string'); // ISO-8601 on the wire (mesh.md §5)
      expect(Number.isNaN(Date.parse(beat['sentAt'] as string))).toBe(false);
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

/** POSTs `benzene:spec` to the envelope endpoint and returns the Contract Document it answers with. */
async function specOverEnvelope(host: ReturnType<typeof createHost>): Promise<Record<string, unknown>> {
  const response = await postEnvelope(host, CloudServicePaths.invoke, 'benzene:spec');
  expect(response.statusCode).toBe(200);
  const envelope = JSON.parse(response.body) as { statusCode: string; body: string };
  expect(envelope.statusCode).toBe('ok');
  return JSON.parse(envelope.body) as Record<string, unknown>;
}

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
