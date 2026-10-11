/**
 * Runs docs/specification/conformance/problem-details-cases.json (wire-contracts.md §1.3, §3.1,
 * §4.1) — the fixture that pins the RFC 9457 problem document itself, rather than the envelope that
 * carries it. Port of the .NET ProblemDetailsConformanceTest.
 *
 * All three of the fixture's groups run here:
 *
 * - `registry` is asserted directly against `ProblemTypes`, no message needed — a port comparing
 *   its own §3.1 table against the spec's.
 * - `envelopeCases` go through the real BenzeneMessage pipeline with the canonical
 *   `conformance:problem` handler registered, exactly as `EnvelopeConformanceTest` runs its own
 *   cases, including the `bodyExclude` absence checks.
 * - `envelopeCases` marked `requires: validation` run `conformance:validate` through the Zod adapter,
 *   asserting `errorFields` (JSON Pointers, wire-contracts §1.3) as a set.
 * - `httpRules` is conditional on a port shipping an HTTP binding, and needs a real HTTP response
 *   line rather than a wire envelope. This port ships several; API Gateway v1 stands in for all of
 *   them, being an in-process HTTP binding with a genuine status line and response headers (.NET
 *   runs the same group over a self-hosted ASP.NET listener). The status-line/body agreement it
 *   pins comes from `useHttpProblemDetailsStatus`, which fills the body's numeric `status` from the
 *   same `IHttpStatusCodeMapper` instance that writes the status line. Its `envelopeEndpoint` cases POST
 *   to `useBenzeneMessage`'s default `/benzene/invoke` (every processed envelope is 200; a malformed one
 *   400), and its `healthEndpoint` cases GET a route mapped to `benzene:healthcheck` with exactly the
 *   case's checks registered (503 when `isHealthy` is false).
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import { BenzeneTopic } from '@benzenejs/abstractions';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
  useMessageHandlersWithRouter,
} from '@benzenejs/core-message-handlers';
import { useZodValidation } from '@benzenejs/zod';
import { InlineHealthCheck, useHealthCheck } from '@benzenejs/health-checks';
import { HealthCheckResult } from '@benzenejs/health-checks-core';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { HttpEndpointDefinition, IHttpEndpointDefinition, useBenzeneMessage } from '@benzenejs/http';
import {
  addApiGateway,
  ApiGatewayApplication,
  ApiGatewayContext,
} from '@benzenejs/aws-lambda-api-gateway';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { httpBuilder } from '@benzenejs/testing';
import { ProblemTypes } from '@benzenejs/results';
import { IBenzeneResult } from '@benzenejs/abstractions';
import { BenzeneClientContext } from '@benzenejs/abstractions-messages';
import { asBenzeneResult, BenzeneMessageClientResponse } from '@benzenejs/clients';
import { HttpContextConverter, HttpSendMessageContext } from '@benzenejs/clients-http';
import { JsonSerializer } from '@benzenejs/core-message-handlers';
import { findSubsetMismatch, load } from './ConformanceFixtures';
import { GreetConformanceHandler } from './Handlers/GreetConformanceHandler';
import { ProblemConformanceHandler } from './Handlers/ProblemConformanceHandler';
import { StatusConformanceHandler } from './Handlers/StatusConformanceHandler';
import { ValidateConformanceHandler } from './Handlers/ValidateConformanceHandler';

interface RegistryRow {
  benzeneStatus: string;
  type: string;
  httpStatus: number;
}

interface EnvelopeExpectation {
  statusCode: string;
  isSuccessful?: boolean;
  body?: unknown;
  bodyExclude?: string[];
  /** The `field`s the problem document's `errors` must carry, compared as a set (README). */
  errorFields?: string[];
}

interface ProblemEnvelopeCase {
  name: string;
  /** `validation`: needs a validation integration that can run `conformance:validate`. */
  requires?: string;
  request: { topic: string; headers: Record<string, string>; body: string };
  expected: EnvelopeExpectation;
}

interface EnvelopeEndpointCase {
  name: string;
  request?: { topic: string; headers: Record<string, string>; body: string };
  rawBody?: string;
  expected: { httpStatus: number; envelope?: EnvelopeExpectation };
}

interface HealthEndpointCase {
  name: string;
  checks: { name: string; status: 'ok' | 'warning' | 'failed' }[];
  expected: { httpStatus: number; body?: unknown };
}

interface HttpRules {
  failureCases: { benzeneStatus: string; httpStatus: number }[];
  successCase: { benzeneStatus: string; httpStatus: number; contentType: string };
  envelopeEndpoint: { path: string; cases: EnvelopeEndpointCase[] };
  healthEndpoint: { path: string; cases: HealthEndpointCase[] };
}

interface ProblemDetailsFixture {
  registry: { rows: RegistryRow[]; unknownStatus: { httpStatus: number } };
  envelopeCases: ProblemEnvelopeCase[];
  httpRules: HttpRules;
}

const fixture = load<ProblemDetailsFixture>('problem-details-cases.json');

async function runPipeline(request: BenzeneMessageRequest) {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  // conformance:validate is validated by this port's own integration (the Zod adapter), wired the way an
  // adopter wires it; the other canonical handlers have no schema and pass straight through.
  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlersWithRouter(
    builder,
    (router) => useZodValidation(router),
    GreetConformanceHandler,
    StatusConformanceHandler,
    ProblemConformanceHandler,
    ValidateConformanceHandler,
  );

  const application = new BenzeneMessageApplication(builder.build());
  return application.handleAsync(request, container.createServiceResolverFactory());
}

/** Asserts an envelope expectation (envelope-cases.json format, plus `errorFields`). */
function assertEnvelope(
  name: string,
  response: { statusCode: string; isSuccessful?: boolean; body: string },
  expected: EnvelopeExpectation,
): void {
  expect(response.statusCode, name).toBe(expected.statusCode);

  if (expected.isSuccessful !== undefined) {
    expect(response.isSuccessful, name).toBe(expected.isSuccessful);
  }

  if (expected.body !== undefined) {
    expect(response.body, `${name}: expected a response body`).toBeTruthy();
    const actualBody = JSON.parse(response.body) as unknown;
    const mismatch = findSubsetMismatch(expected.body, actualBody);
    expect(mismatch, mismatch ?? undefined).toBeNull();
  }

  if (expected.bodyExclude !== undefined) {
    const actualBody = JSON.parse(response.body) as Record<string, unknown>;
    for (const excludedMember of expected.bodyExclude) {
      expect(excludedMember in actualBody, `${name}: body member '${excludedMember}' must be genuinely absent`).toBe(
        false,
      );
    }
  }

  if (expected.errorFields !== undefined) {
    const errors = (JSON.parse(response.body) as { errors?: { field?: string }[] }).errors ?? [];
    for (const error of errors) {
      expect(error.field, `${name}: every error carries a field`).toBeDefined();
    }
    expect(new Set(errors.map((error) => error.field))).toEqual(new Set(expected.errorFields));
  }
}

/**
 * core-concepts §12 "Error fidelity": what a CLIENT rebuilds from the problem document it received. The
 * result carries the document's `errors` - message, `field` and `code` intact, in order - and the received
 * document is attached, so an application's own `type` survives the hop.
 */
function assertClientFidelity(name: string, result: IBenzeneResult, received: string, expected: EnvelopeExpectation): void {
  const document = JSON.parse(received) as { type?: string; errors?: unknown[] };
  expect(result.isSuccessful, name).toBe(false);
  expect(result.status, name).toBe(expected.statusCode);
  expect(result.errors, `${name}: the received errors, field and code intact`).toEqual(document.errors ?? []);
  const expectedErrors = (expected.body as { errors?: unknown[] } | undefined)?.errors;
  if (expectedErrors !== undefined) {
    expect(result.errors, name).toEqual(expectedErrors);
  }
  if (expected.errorFields !== undefined) {
    expect(new Set(result.errors.map((error) => error.field))).toEqual(new Set(expected.errorFields));
  }
  expect(ProblemTypes.from(result).type, `${name}: the received document is attached`).toBe(document.type);
}

/**
 * POSTs a case's request to its topic over a route-mapped HTTP binding (API Gateway) - so the failure is
 * an `application/problem+json` response, not an envelope - with the canonical handlers behind it.
 */
async function postCaseAsync(problemCase: ProblemEnvelopeCase): Promise<APIGatewayProxyResult> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addApiGateway(container);
  container.addSingletonFactory(
    IHttpEndpointDefinition,
    () => new HttpEndpointDefinition('POST', '/conformance-case', problemCase.request.topic),
  );

  const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
  useMessageHandlersWithRouter(builder, (router) => useZodValidation(router), ProblemConformanceHandler, ValidateConformanceHandler);

  const event = asApiGatewayRequest(httpBuilder('POST', '/conformance-case'));
  event.body = problemCase.request.body;
  return new ApiGatewayApplication(builder.build()).handleAsync(event, container.createServiceResolverFactory());
}

/** Capabilities this port implements, for cases marked `requires`. */
const capabilities = new Set(['validation']);

/**
 * POSTs a body to the envelope endpoint (`useBenzeneMessage`, default path) over API Gateway — an HTTP
 * binding with a genuine status line — with the canonical handlers behind it.
 */
async function postEnvelopeAsync(path: string, body: string): Promise<APIGatewayProxyResult> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addApiGateway(container);

  const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
  useBenzeneMessage(builder, (envelope) =>
    useMessageHandlers(envelope, GreetConformanceHandler, StatusConformanceHandler, ProblemConformanceHandler),
  );

  const event = asApiGatewayRequest(httpBuilder('POST', path));
  event.body = body;
  return new ApiGatewayApplication(builder.build()).handleAsync(event, container.createServiceResolverFactory());
}

/** GETs a health path mapped to `benzene:healthcheck`, with exactly the case's checks registered. */
async function getHealthAsync(path: string, checks: HealthEndpointCase['checks']): Promise<APIGatewayProxyResult> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addApiGateway(container);
  container.addSingletonFactory(
    IHttpEndpointDefinition,
    () => new HttpEndpointDefinition('GET', path, BenzeneTopic.healthCheck),
  );

  const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
  useHealthCheck(
    builder,
    BenzeneTopic.healthCheck,
    checks.map(
      (check) =>
        new InlineHealthCheck(check.name, () =>
          Promise.resolve(
            check.status === 'warning'
              ? HealthCheckResult.createWarning(check.name)
              : HealthCheckResult.createInstance(check.status === 'ok', check.name),
          ),
        ),
    ),
  );
  useMessageHandlers(builder);

  return new ApiGatewayApplication(builder.build()).handleAsync(
    asApiGatewayRequest(httpBuilder('GET', path)),
    container.createServiceResolverFactory(),
  );
}

/**
 * POSTs `{ status }` to the canonical `conformance:status` handler over a real HTTP binding and
 * returns the response's status line, content type, and body — the port's counterpart of the .NET
 * runner's `PostStatusAsync` against a self-hosted listener.
 */
async function postStatusAsync(
  benzeneStatus: string,
): Promise<{ statusCode: number; contentType: string | undefined; body: string }> {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addApiGateway(container);
  // The canonical handler carries no `@httpEndpoint`, so the route is registered the way the .NET
  // runner registers its own IHttpEndpointDefinition: as a dependency the route finder collects.
  container.addSingletonFactory(
    IHttpEndpointDefinition,
    () => new HttpEndpointDefinition('POST', '/conformance-status', 'conformance:status'),
  );

  const builder = new MiddlewarePipelineBuilder<ApiGatewayContext>(container);
  useMessageHandlers(builder, StatusConformanceHandler);

  const application = new ApiGatewayApplication(builder.build());
  const response: APIGatewayProxyResult = await application.handleAsync(
    asApiGatewayRequest(httpBuilder('POST', '/conformance-status', { status: benzeneStatus })),
    container.createServiceResolverFactory(),
  );

  return {
    statusCode: response.statusCode,
    contentType: response.headers?.['content-type'] as string | undefined,
    body: response.body,
  };
}

function toRequest(problemCase: ProblemEnvelopeCase): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = problemCase.request.topic;
  request.headers = problemCase.request.headers;
  request.body = problemCase.request.body;
  return request;
}

describe('ProblemDetailsConformanceTest', () => {
  describe('registry (wire-contracts.md §3.1)', () => {
    for (const row of fixture.registry.rows) {
      it(`${row.benzeneStatus} maps to its type URI and HTTP status`, () => {
        expect(ProblemTypes.typeFor(row.benzeneStatus)).toBe(row.type);
        expect(ProblemTypes.httpStatusFor(row.benzeneStatus)).toBe(row.httpStatus);
        // Titles are fixed per type but their wording is never asserted by the fixtures — only
        // that a framework status HAS one, so a document is never left title-less.
        expect(ProblemTypes.titleFor(row.benzeneStatus)).toBeTruthy();
      });
    }

    it('an application-defined status has no registry row and falls to the unknown HTTP status', () => {
      // §3.1: such a failure carries the application's own URI or omits the member — the framework
      // never invents one under the benzene.app namespace on the application's behalf.
      expect(ProblemTypes.typeFor('quota-exhausted')).toBeUndefined();
      expect(ProblemTypes.titleFor('quota-exhausted')).toBeUndefined();
      expect(ProblemTypes.httpStatusFor('quota-exhausted')).toBe(
        fixture.registry.unknownStatus.httpStatus,
      );
    });

    it('a success status has no problem type — problems exist only on failure', () => {
      expect(ProblemTypes.typeFor('ok')).toBeUndefined();
      expect(ProblemTypes.typeFor('created')).toBeUndefined();
    });
  });

  describe('envelopeCases (wire-contracts.md §1.3)', () => {
    for (const problemCase of fixture.envelopeCases) {
      const run = problemCase.requires === undefined || capabilities.has(problemCase.requires) ? it : it.skip;
      run(problemCase.name, async () => {
        const response = await runPipeline(toRequest(problemCase));

        expect(response).toBeDefined();
        assertEnvelope(problemCase.name, response, problemCase.expected);
      });
    }
  });

  // core-concepts §12 "Error fidelity", from the client side: each case's real failure, read back by this
  // port's clients - the envelope reader (`asBenzeneResult`, what DefaultBenzeneMessageSender uses) and the
  // HTTP client (`HttpContextConverter`) on a route-mapped `application/problem+json` response.
  describe('client error fidelity (core-concepts §12)', () => {
    for (const problemCase of fixture.envelopeCases) {
      const run = problemCase.requires === undefined || capabilities.has(problemCase.requires) ? it : it.skip;

      run(`${problemCase.name}: envelope client`, async () => {
        const response = await runPipeline(toRequest(problemCase));
        const received = new BenzeneMessageClientResponse(response!.statusCode, response!.body, response!.headers, response!.isSuccessful);
        const result = asBenzeneResult<unknown>(received, new JsonSerializer());
        assertClientFidelity(problemCase.name, result, response!.body, problemCase.expected);
      });

      run(`${problemCase.name}: HTTP client`, async () => {
        const http = await postCaseAsync(problemCase);
        expect(http.headers?.['content-type']).toMatch(/^application\/problem\+json/);
        const context = new HttpSendMessageContext({ url: '/conformance-case', method: 'POST', headers: {}, body: '' });
        context.response = new Response(http.body, {
          status: http.statusCode,
          headers: { 'content-type': String(http.headers!['content-type']) },
        });
        const clientContext = new BenzeneClientContext<unknown, unknown>({ topic: problemCase.request.topic, message: {}, headers: {} });
        await new HttpContextConverter<unknown, unknown>('POST', '/conformance-case').mapResponseAsync(clientContext, context);
        assertClientFidelity(problemCase.name, clientContext.response as IBenzeneResult, http.body, problemCase.expected);
      });
    }
  });

  describe('httpRules (wire-contracts.md §4.1)', () => {
    for (const failureCase of fixture.httpRules.failureCases) {
      it(`${failureCase.benzeneStatus} maps to ${failureCase.httpStatus} on the status line and in the body`, async () => {
        const { statusCode, contentType, body } = await postStatusAsync(failureCase.benzeneStatus);

        expect(statusCode).toBe(failureCase.httpStatus);
        expect(contentType).toBeDefined();
        expect(contentType?.startsWith('application/problem+json')).toBe(true);

        const problem = JSON.parse(body) as { status?: unknown };
        expect(
          'status' in problem,
          `${failureCase.benzeneStatus}: expected a numeric 'status' member on the HTTP-bound problem document`,
        ).toBe(true);
        expect(problem.status).toBe(failureCase.httpStatus);
      });
    }

    describe('envelopeEndpoint (transport-bindings.md §1)', () => {
      const { path, cases } = fixture.httpRules.envelopeEndpoint;
      for (const endpointCase of cases) {
        it(endpointCase.name, async () => {
          const response = await postEnvelopeAsync(
            path,
            endpointCase.rawBody ?? JSON.stringify(endpointCase.request),
          );

          expect(response.statusCode).toBe(endpointCase.expected.httpStatus);
          if (endpointCase.expected.envelope !== undefined) {
            const envelope = JSON.parse(response.body) as { statusCode: string; isSuccessful?: boolean; body: string };
            assertEnvelope(endpointCase.name, envelope, endpointCase.expected.envelope);
          }
        });
      }
    });

    describe('healthEndpoint (transport-bindings.md §1, wire-contracts.md §5)', () => {
      const { path, cases } = fixture.httpRules.healthEndpoint;
      for (const healthCase of cases) {
        it(healthCase.name, async () => {
          const response = await getHealthAsync(path, healthCase.checks);

          expect(response.statusCode).toBe(healthCase.expected.httpStatus);
          if (healthCase.expected.body !== undefined) {
            const mismatch = findSubsetMismatch(healthCase.expected.body, JSON.parse(response.body) as unknown);
            expect(mismatch, mismatch ?? undefined).toBeNull();
          }
        });
      }
    });

    it('a success response is unaffected: no problem document, ordinary content type', async () => {
      const { successCase } = fixture.httpRules;
      const { statusCode, contentType, body } = await postStatusAsync(successCase.benzeneStatus);

      expect(statusCode).toBe(successCase.httpStatus);
      expect(contentType).toBeDefined();
      expect(contentType?.startsWith(successCase.contentType)).toBe(true);
      expect(body).not.toContain('"status"');
      expect(body).not.toContain('"benzeneStatus"');
      expect(body).not.toContain('"type"');
    });
  });
});
