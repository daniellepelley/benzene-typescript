/**
 * Runs docs/specification/conformance/problem-details-cases.json (wire-contracts.md §1.3, §3.1,
 * §4.1) — the fixture that pins the RFC 9457 problem document itself, rather than the envelope that
 * carries it. Port of the .NET ProblemDetailsConformanceTest.
 *
 * Two of the fixture's three groups run here:
 *
 * - `registry` is asserted directly against `ProblemTypes`, no message needed — a port comparing
 *   its own §3.1 table against the spec's.
 * - `envelopeCases` go through the real BenzeneMessage pipeline with the canonical
 *   `conformance:problem` handler registered, exactly as `EnvelopeConformanceTest` runs its own
 *   cases, including the `bodyExclude` absence checks.
 *
 * `httpRules` is the third group and is deliberately NOT run here: it is conditional on a port
 * shipping an HTTP binding, and asserting it needs a real HTTP response line rather than a wire
 * envelope. See the note at the bottom of this file.
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzenejs/core-messages';
import { MiddlewarePipelineBuilder } from '@benzenejs/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzenejs/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzenejs/dependencies';
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

interface ProblemDetailsFixture {
  registry: { rows: RegistryRow[]; unknownStatus: { httpStatus: number } };
  envelopeCases: ProblemEnvelopeCase[];
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
});
