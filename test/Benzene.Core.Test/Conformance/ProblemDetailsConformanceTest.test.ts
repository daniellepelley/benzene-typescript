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
 * - `httpRules` is conditional on a port shipping an HTTP binding, and needs a real HTTP response
 *   line rather than a wire envelope. This port ships several; API Gateway v1 stands in for all of
 *   them, being an in-process HTTP binding with a genuine status line and response headers (.NET
 *   runs the same group over a self-hosted ASP.NET listener). The status-line/body agreement it
 *   pins comes from `useHttpProblemDetailsStatus`, which fills the body's numeric `status` from the
 *   same `IHttpStatusCodeMapper` instance that writes the status line.
 */
import { describe, expect, it } from 'vitest';
import { APIGatewayProxyResult } from 'aws-lambda';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
import { HttpEndpointDefinition, IHttpEndpointDefinition } from '@benzenejs/http';
import {
  addApiGateway,
  ApiGatewayApplication,
  ApiGatewayContext,
} from '@benzenejs/aws-lambda-api-gateway';
import { asApiGatewayRequest } from '@benzenejs/aws-lambda-testing';
import { httpBuilder } from '@benzenejs/testing';
import { ProblemTypes } from '@benzenejs/results';
import { findSubsetMismatch, load } from './ConformanceFixtures';
import { GreetConformanceHandler } from './Handlers/GreetConformanceHandler';
import { ProblemConformanceHandler } from './Handlers/ProblemConformanceHandler';
import { StatusConformanceHandler } from './Handlers/StatusConformanceHandler';

interface RegistryRow {
  benzeneStatus: string;
  type: string;
  httpStatus: number;
}

interface ProblemEnvelopeCase {
  name: string;
  request: { topic: string; headers: Record<string, string>; body: string };
  expected: {
    statusCode: string;
    isSuccessful?: boolean;
    body?: unknown;
    bodyExclude?: string[];
  };
}

interface HttpRules {
  failureCases: { benzeneStatus: string; httpStatus: number }[];
  successCase: { benzeneStatus: string; httpStatus: number; contentType: string };
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

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(
    builder,
    GreetConformanceHandler,
    StatusConformanceHandler,
    ProblemConformanceHandler,
  );

  const application = new BenzeneMessageApplication(builder.build());
  return application.handleAsync(request, container.createServiceResolverFactory());
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
      it(problemCase.name, async () => {
        const response = await runPipeline(toRequest(problemCase));

        expect(response).toBeDefined();
        expect(response.statusCode).toBe(problemCase.expected.statusCode);

        if (problemCase.expected.isSuccessful !== undefined) {
          expect(response.isSuccessful).toBe(problemCase.expected.isSuccessful);
        }

        if (problemCase.expected.body !== undefined) {
          expect(response.body, `${problemCase.name}: expected a response body`).toBeTruthy();
          const actualBody = JSON.parse(response.body) as unknown;
          const mismatch = findSubsetMismatch(problemCase.expected.body, actualBody);
          expect(mismatch, mismatch ?? undefined).toBeNull();
        }

        if (problemCase.expected.bodyExclude !== undefined) {
          const actualBody = JSON.parse(response.body) as Record<string, unknown>;
          for (const excludedMember of problemCase.expected.bodyExclude) {
            expect(
              excludedMember in actualBody,
              `${problemCase.name}: body member '${excludedMember}' must be genuinely absent`,
            ).toBe(false);
          }
        }
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
