/**
 * Runs docs/specification/conformance/envelope-cases.json through the real BenzeneMessage pipeline
 * with the canonical conformance handlers registered - the TypeScript reference runner for the
 * envelope contract (wire-contracts.md section 1). Port of the .NET EnvelopeConformanceTest
 * (Benzene.Conformance.Test/EnvelopeConformanceTest.cs).
 *
 * Each case pushes a `BenzeneMessageRequest` (topic + headers + body) through the same
 * `addBenzene` + `addBenzeneMessage` + `useMessageHandlers` pipeline an adopter wires, and asserts the
 * response's `statusCode`, body (subset match) and headers (subset match, case-insensitive keys).
 */
import { describe, expect, it } from 'vitest';
import { BenzeneMessageContext, BenzeneMessageRequest } from '@benzene/core-messages';
import { MiddlewarePipelineBuilder } from '@benzene/core-middleware';
import {
  addBenzene,
  addBenzeneMessage,
  BenzeneMessageApplication,
  useMessageHandlers,
} from '@benzene/core-message-handlers';
import { DefaultBenzeneServiceContainer } from '@benzene/dependencies';
import { findSubsetMismatch, load } from './ConformanceFixtures';
import { GreetConformanceHandler } from './Handlers/GreetConformanceHandler';
import { StatusConformanceHandler } from './Handlers/StatusConformanceHandler';

interface EnvelopeCase {
  name: string;
  request: { topic: string; headers: Record<string, string>; body: string };
  expected: {
    statusCode: string;
    body?: unknown;
    headers?: Record<string, string>;
  };
}

interface EnvelopeFixture {
  cases: EnvelopeCase[];
}

const fixture = load<EnvelopeFixture>('envelope-cases.json');

async function runPipeline(request: BenzeneMessageRequest) {
  const container = new DefaultBenzeneServiceContainer();
  addBenzene(container);
  addBenzeneMessage(container);

  const builder = new MiddlewarePipelineBuilder<BenzeneMessageContext>(container);
  useMessageHandlers(builder, GreetConformanceHandler, StatusConformanceHandler);

  const application = new BenzeneMessageApplication(builder.build());
  return application.handleAsync(request, container.createServiceResolverFactory());
}

function toRequest(envelopeCase: EnvelopeCase): BenzeneMessageRequest {
  const request = new BenzeneMessageRequest();
  request.topic = envelopeCase.request.topic;
  request.headers = envelopeCase.request.headers;
  request.body = envelopeCase.request.body;
  return request;
}

describe('EnvelopeConformanceTest', () => {
  for (const envelopeCase of fixture.cases) {
    it(envelopeCase.name, async () => {
      const response = await runPipeline(toRequest(envelopeCase));

      expect(response).toBeDefined();
      expect(response.statusCode).toBe(envelopeCase.expected.statusCode);

      if (envelopeCase.expected.body !== undefined) {
        expect(response.body, `${envelopeCase.name}: expected a response body but none was written`)
          .toBeTruthy();
        const actualBody = JSON.parse(response.body) as unknown;
        const mismatch = findSubsetMismatch(envelopeCase.expected.body, actualBody);
        expect(mismatch, mismatch ?? undefined).toBeNull();
      }

      if (envelopeCase.expected.headers !== undefined) {
        for (const [key, value] of Object.entries(envelopeCase.expected.headers)) {
          const actualKey = Object.keys(response.headers ?? {}).find(
            (k) => k.toLowerCase() === key.toLowerCase(),
          );
          const actualValue = actualKey === undefined ? undefined : response.headers[actualKey];
          expect(
            actualValue,
            `${envelopeCase.name}: header '${key}' expected '${value}' but found '${actualValue ?? '<missing>'}'`,
          ).toBe(value);
        }
      }
    });
  }
});
